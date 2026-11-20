import { createHash } from "node:crypto";
import { db, eq, voiceGenderOverrides } from "@workspace/db";
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
type ProviderVoice = Omit<CatalogVoice, "gender" | "genderSource"> & { providerGender: VoiceGender | null };
type ProviderLoad = { status: ProviderState["status"]; voices: ProviderVoice[] };
type CacheEntry = { key: string; until: number; value: ProviderLoad };
type Override = { providerId: VoiceProviderId; voiceId: string; gender: VoiceGender };
type OverrideStore = {
  list(): Promise<Override[]>;
  set(providerId: VoiceProviderId, voiceId: string, gender: VoiceGender, operatorUserId: string): Promise<void>;
};

const endpoint: Record<VoiceProviderId, string> = {
  anam: "https://api.anam.ai/v1/voices",
  tavus: "https://tavusapi.com/v2/voices",
};
const maxPages = 10;
const pageSize = 100;
const maxBodyBytes = 2_000_000;
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
      providerGender: genderValue(voice.gender) },
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBodyBytes || !response.body) throw new Error("invalid_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) throw new Error("body_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
}

export class VoiceCatalog {
  private cache = new Map<VoiceProviderId, CacheEntry>();
  private pending = new Map<VoiceProviderId, { key: string; result: Promise<ProviderLoad> }>();

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

  private async load(providerId: VoiceProviderId, key: string): Promise<ProviderLoad> {
    const fingerprint = createHash("sha256").update(key).digest("hex");
    const cached = this.cache.get(providerId);
    if (cached?.key === fingerprint && cached.until > this.now()) return cached.value;
    const existing = this.pending.get(providerId);
    if (existing?.key === fingerprint) return existing.result;
    const task = this.fetchProvider(providerId, key).catch(() => ({
      status: "unavailable" as const, voices: [],
    })).then(value => {
      this.cache.set(providerId, { key: fingerprint, until: this.now() + (value.status === "available" ? 300_000 : 30_000), value });
      return value;
    }).finally(() => {
      if (this.pending.get(providerId)?.result === task) this.pending.delete(providerId);
    });
    this.pending.set(providerId, { key: fingerprint, result: task });
    return task;
  }

  private async fetchProvider(providerId: VoiceProviderId, key: string): Promise<ProviderLoad> {
    const voices = new Map<string, ProviderVoice>();
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(endpoint[providerId]);
      if (providerId === "tavus") {
        url.searchParams.set("source", "all");
        url.searchParams.set("limit", String(pageSize));
        url.searchParams.set("page", String(page));
      } else {
        url.searchParams.set("page", String(page));
        url.searchParams.set("perPage", String(pageSize));
      }
      const response = await this.request(url, {
        method: "GET",
        headers: providerId === "tavus" ? { "x-api-key": key, Accept: "application/json" }
          : { Authorization: `Bearer ${key}`, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(7_000),
      });
      if (!response.ok) throw new Error("catalog_rejected");
      const rows = pickArray(await boundedJson(response));
      if (!rows || rows.length > pageSize) throw new Error("invalid_catalog");
      for (const row of rows) {
        const normalized = normalizeVoice(providerId, row);
        if (normalized) voices.set(normalized.voice.id, normalized.voice);
      }
      if (rows.length < pageSize) return { status: "available", voices: [...voices.values()] };
    }
    throw new Error("incomplete_catalog");
  }

  async list(): Promise<{ providers: ProviderState[]; voices: CatalogVoice[] }> {
    const keys = this.keys();
    const [anam, tavus, overrides] = await Promise.all([
      keys.anam ? this.load("anam", keys.anam)
        : Promise.resolve<ProviderLoad>({ status: "unconfigured", voices: [] }),
      keys.tavus ? this.load("tavus", keys.tavus)
        : Promise.resolve<ProviderLoad>({ status: "unconfigured", voices: [] }),
      this.overrides.list(),
    ]).catch(() => {
      throw new SessionProblem(503, "VOICE_CATALOG_UNAVAILABLE", "Voice catalog settings are temporarily unavailable.");
    });
    const overrideMap = new Map(overrides.map(row => [JSON.stringify([row.providerId, row.voiceId]), row.gender]));
    const merge = (providerId: VoiceProviderId, result: ProviderLoad) => result.voices.map(voice => {
      const override = overrideMap.get(JSON.stringify([providerId, voice.id]));
      const { providerGender, ...publicVoice } = voice;
      return {
        ...publicVoice,
        gender: override ?? providerGender ?? "unclassified",
        genderSource: override !== undefined ? "admin" as const : providerGender ? "provider" as const : "unknown" as const,
      };
    });
    const providerStates: ProviderState[] = [
      { providerId: "anam", status: anam.status, errorCode: anam.status === "unavailable" ? "VOICE_CATALOG_UNAVAILABLE" : null },
      { providerId: "tavus", status: tavus.status, errorCode: tavus.status === "unavailable" ? "VOICE_CATALOG_UNAVAILABLE" : null },
    ];
    return { providers: providerStates, voices: [...merge("anam", anam), ...merge("tavus", tavus)] };
  }

  async requireSelection(providerId: VoiceProviderId, voiceId: string, expectedGender?: VoiceGender) {
    const catalog = await this.list();
    const provider = catalog.providers.find(entry => entry.providerId === providerId);
    if (provider?.status !== "available") {
      throw new SessionProblem(503, "VOICE_CATALOG_UNAVAILABLE", "The selected provider voice catalog is not available. No live session was created.");
    }
    const voice = catalog.voices.find(entry => entry.providerId === providerId && entry.id === voiceId);
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
    await this.overrides.set(providerId, voiceId, gender, operatorUserId);
    const updated = await this.list();
    return updated.voices.find(voice => voice.providerId === providerId && voice.id === voiceId)!;
  }
}

export const voiceCatalog = new VoiceCatalog();
