import { createHash } from "node:crypto";
import { db, eq, voiceGenderOverrides } from "@workspace/db";
import { logger } from "./logger";
import { readCatalogJson, verifiedCatalogPages } from "./provider-catalog-http";
import { SessionProblem } from "./session-service";

export type VoiceProviderId = "anam" | "tavus";
export type VoiceGender = "male" | "female" | "neutral" | "unclassified";
export type VoiceGenderSource = "provider" | "admin" | "unknown";
export type CatalogVoice = {
  id: string;
  providerId: VoiceProviderId;
  name: string;
  description: string;
  gender: VoiceGender;
  genderSource: VoiceGenderSource;
  languages: string[];
  available: boolean;
};
type ProviderState = { providerId: VoiceProviderId; status: "available" | "unconfigured" | "unavailable"; errorCode: string | null };
type ProviderVoice = Omit<CatalogVoice, "gender" | "genderSource"> & { providerGender: VoiceGender | null; stock: boolean };
type ProviderLoad = { status: ProviderState["status"]; voices: ProviderVoice[] };
type CacheEntry = { key: string; until: number; value: ProviderLoad };
type Override = { providerId: VoiceProviderId; voiceId: string; gender: VoiceGender };
type OverrideStore = {
  list(): Promise<Override[]>;
  set(providerId: VoiceProviderId, voiceId: string, gender: VoiceGender, operatorUserId: string): Promise<void>;
};

export function voiceOverrideFailureReason(error: unknown) {
  // Drizzle wraps PostgreSQL errors; log only an allowlisted classification.
  for (let depth = 0; depth < 3 && error && typeof error === "object"; depth++) {
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (code === "42P01") return "missing_table";
    if (code === "42703") return "missing_column";
    if (code === "42501") return "permission_denied";
    error = cause;
  }
  return "read_or_write_failed";
}

const endpoint: Record<VoiceProviderId, string> = {
  anam: "https://api.anam.ai/v1/voices",
  tavus: "https://tavusapi.com/v2/voices",
};
const maxPages = 10;
const pageSize = 100;
const safeText = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim() : "";

function pickArray(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> =>
    !!row && typeof row === "object" && !Array.isArray(row));
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of ["data", "voices", "items", "results"]) {
    if (Array.isArray(object[key])) return pickArray(object[key]);
  }
  return null;
}

function genderValue(value: unknown): VoiceGender | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  if (normalized === "male" || normalized === "female" || normalized === "neutral") return normalized;
  return null;
}

function languagesValue(voice: Record<string, unknown>): string[] {
  const raw = voice.languages ?? voice.languageCodes ?? voice.language_codes ?? voice.language;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return [...new Set(values.map(value => safeText(value, 40)).filter(Boolean))].slice(0, 20);
}

function normalizeVoice(providerId: VoiceProviderId, voice: Record<string, unknown>): {
  voice: ProviderVoice;
} | null {
  const id = safeText(providerId === "tavus" ? voice.voice_id ?? voice.id : voice.id ?? voice.voiceId, 160);
  const name = safeText(providerId === "tavus" ? voice.voice_name ?? voice.name : voice.displayName ?? voice.name, 200);
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) || !name) return null;
  const status = safeText(voice.status, 40).toLowerCase();
  const explicitAvailable = voice.available ?? voice.isAvailable ?? voice.is_active;
  const available = typeof explicitAvailable === "boolean" ? explicitAvailable
    : !status || ["active", "available", "ready", "completed"].includes(status);
  const description = safeText(voice.description, 1000);
  return {
    voice: { id, providerId, name, description, languages: languagesValue(voice), available,
      providerGender: genderValue(voice.gender),
      stock: providerId === "anam" ? voice.createdByOrganizationId === null : voice.voice_type === "system" },
  };
}

export class VoiceCatalog {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, { key: string; result: Promise<ProviderLoad> }>();

  constructor(
    private request: typeof fetch = fetch,
    private now = () => Date.now(),
    private overrides: OverrideStore = {
      list: async () => {
        const rows = await db.select().from(voiceGenderOverrides);
        return rows.map(row => ({ providerId: row.providerId, voiceId: row.voiceId, gender: row.gender }));
      },
      set: async (providerId, voiceId, gender, operatorUserId) => {
        await db.insert(voiceGenderOverrides).values({
          providerId, voiceId, gender, updatedBy: operatorUserId, updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [voiceGenderOverrides.providerId, voiceGenderOverrides.voiceId],
          set: { gender, updatedBy: operatorUserId, updatedAt: new Date() },
        });
      },
    },
    private keys = () => ({ anam: process.env.ANAM_API_KEY, tavus: process.env.TAVUS_API_KEY }),
  ) {}

  private async load(providerId: VoiceProviderId, key: string, stockOnly = false): Promise<ProviderLoad> {
    // Anam's endpoint supplies stock and account voices in one list. Share
    // pagination/cache internally while keeping the stock response filtered.
    const useTavusStock = providerId === "tavus" && stockOnly;
    const scope = `${providerId}:${useTavusStock ? "stock" : "all"}`;
    const fingerprint = createHash("sha256").update(key).digest("hex");
    const cached = this.cache.get(scope);
    if (cached?.key === fingerprint && cached.until > this.now()) return cached.value;
    const existing = this.pending.get(scope);
    if (existing?.key === fingerprint) return existing.result;
    const task = (providerId === "anam" || useTavusStock
      ? this.fetchVerified(providerId, key)
      : this.fetchTavusIntegration(key)).catch(() => ({
      status: "unavailable" as const, voices: [],
    })).then(value => {
      if (this.pending.get(scope)?.result === task) {
        this.cache.set(scope, { key: fingerprint, until: this.now() + (value.status === "available" ? 300_000 : 30_000), value });
      }
      return value;
    }).finally(() => {
      if (this.pending.get(scope)?.result === task) this.pending.delete(scope);
    });
    this.pending.set(scope, { key: fingerprint, result: task });
    return task;
  }

  private async fetchTavusIntegration(key: string): Promise<ProviderLoad> {
    const voices = new Map<string, ProviderVoice>();
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(endpoint.tavus);
      url.search = new URLSearchParams({ source: "all", limit: String(pageSize), page: String(page) }).toString();
      const response = await this.request(url, {
        method: "GET",
        headers: { "x-api-key": key, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(7_000),
      });
      if (!response.ok) throw new Error("catalog_rejected");
      const rows = pickArray(await readCatalogJson(response));
      if (!rows || rows.length > pageSize) throw new Error("invalid_catalog");
      for (const row of rows) {
        const normalized = normalizeVoice("tavus", row);
        if (normalized) voices.set(normalized.voice.id, normalized.voice);
      }
      if (rows.length < pageSize) return { status: "available", voices: [...voices.values()] };
    }
    throw new Error("incomplete_catalog");
  }

  private async fetchVerified(providerId: VoiceProviderId, key: string): Promise<ProviderLoad> {
    const voices = new Map<string, ProviderVoice>();
    for await (const rows of verifiedCatalogPages(this.request, providerId, endpoint[providerId], key,
      providerId === "tavus" ? { source: "system" } : {})) {
      for (const row of rows) {
        const normalized = normalizeVoice(providerId, row);
        if (normalized) voices.set(normalized.voice.id, normalized.voice);
      }
    }
    return { status: "available", voices: [...voices.values()] };
  }

  private async classifications() {
    const overrides = await this.overrides.list().catch(error => {
      logger.warn({ stage: "read", reason: voiceOverrideFailureReason(error) }, "Voice catalog override storage unavailable");
      throw new SessionProblem(503, "VOICE_CATALOG_UNAVAILABLE", "Voice catalog settings are temporarily unavailable.");
    });
    return new Map(overrides.map(row => [JSON.stringify([row.providerId, row.voiceId]), row.gender]));
  }

  private classify(result: ProviderLoad, overrides: Awaited<ReturnType<VoiceCatalog["classifications"]>>): CatalogVoice[] {
    return result.voices.map(({ providerGender, stock: _stock, ...voice }) => {
      const override = overrides.get(JSON.stringify([voice.providerId, voice.id]));
      return {
        ...voice,
        gender: override ?? providerGender ?? "unclassified",
        genderSource: override !== undefined ? "admin" : providerGender ? "provider" : "unknown",
      };
    });
  }

  async listStock(providerId: VoiceProviderId): Promise<{ status: ProviderState["status"]; voices: CatalogVoice[] }> {
    const key = this.keys()[providerId];
    if (!key) return { status: "unconfigured", voices: [] };
    const result = await this.load(providerId, key, true);
    const stock = result.voices.filter(voice => voice.stock);
    if (result.status !== "available" || stock.length === 0) return { status: result.status, voices: [] };
    return { status: "available", voices: this.classify({ ...result, voices: stock }, await this.classifications()) };
  }

  async list(): Promise<{ providers: ProviderState[]; voices: CatalogVoice[] }> {
    const keys = this.keys();
    const [anam, tavus, overrides] = await Promise.all([
      keys.anam ? this.load("anam", keys.anam)
        : Promise.resolve<ProviderLoad>({ status: "unconfigured", voices: [] }),
      keys.tavus ? this.load("tavus", keys.tavus)
        : Promise.resolve<ProviderLoad>({ status: "unconfigured", voices: [] }),
      this.classifications(),
    ]);
    const providerStates: ProviderState[] = [
      { providerId: "anam", status: anam.status, errorCode: anam.status === "unavailable" ? "VOICE_CATALOG_UNAVAILABLE" : null },
      { providerId: "tavus", status: tavus.status, errorCode: tavus.status === "unavailable" ? "VOICE_CATALOG_UNAVAILABLE" : null },
    ];
    return { providers: providerStates, voices: [...this.classify(anam, overrides), ...this.classify(tavus, overrides)] };
  }

  async requireSelection(providerId: VoiceProviderId, voiceId: string, expectedGender?: VoiceGender) {
    const key = this.keys()[providerId];
    const [result, overrides] = await Promise.all([
      key ? this.load(providerId, key) : Promise.resolve<ProviderLoad>({ status: "unconfigured", voices: [] }),
      this.classifications(),
    ]);
    if (result.status !== "available") {
      throw new SessionProblem(503, "VOICE_CATALOG_UNAVAILABLE", "The selected provider voice catalog is not available. No live session was created.");
    }
    const entry = result.voices.find(voice => voice.id === voiceId);
    const [voice] = entry ? this.classify({ ...result, voices: [entry] }, overrides) : [];
    if (!voice || !voice.available || voice.gender === "unclassified") {
      throw new SessionProblem(409, "VOICE_NOT_AVAILABLE", "The selected voice is not available or has no approved gender classification. Refresh the catalog; no live session was created.");
    }
    if (expectedGender && expectedGender !== voice.gender) {
      throw new SessionProblem(409, "VOICE_GENDER_CHANGED", "The selected voice classification changed. Choose an available voice again; no live session was created.");
    }
    return voice;
  }

  async setGender(providerId: VoiceProviderId, voiceId: string, gender: VoiceGender, operatorUserId: string) {
    const catalog = await this.list();
    if (!catalog.voices.some(voice => voice.providerId === providerId && voice.id === voiceId)) {
      throw new SessionProblem(404, "VOICE_NOT_FOUND", "That voice is not in the current provider catalog.");
    }
    await this.overrides.set(providerId, voiceId, gender, operatorUserId).catch(error => {
      logger.warn({ stage: "write", reason: voiceOverrideFailureReason(error) }, "Voice catalog override storage unavailable");
      throw new SessionProblem(503, "VOICE_CATALOG_UNAVAILABLE", "Voice catalog settings are temporarily unavailable.");
    });
    const updated = await this.list();
    return updated.voices.find(voice => voice.providerId === providerId && voice.id === voiceId)!;
  }
}

export const voiceCatalog = new VoiceCatalog();
