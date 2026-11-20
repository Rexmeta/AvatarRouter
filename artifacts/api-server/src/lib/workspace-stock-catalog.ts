import { createHash } from "node:crypto";
import { stockCatalogPages } from "./provider-catalog-http";
import { stockCatalog } from "./stock-catalog";
import { voiceCatalog, type VoiceProviderId } from "./voice-catalog";

type Status = "available" | "unconfigured" | "unavailable";
type StockList<T> = { status: Status; items: T[] };
type Selection = "supported" | "browse_only";
type Face = { id: string; name: string; selection: Selection; thumbnailUrl: string | null };

function publicImage(input: unknown, provider: VoiceProviderId, id: string) {
  if (typeof input !== "string" || input.length > 1000) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
    if (provider === "tavus") {
      if (url.hostname !== "cdn.replica.tavus.io" || url.search || !/\.(png|jpe?g|webp|avif)$/i.test(url.pathname)) return null;
    } else {
      if (url.hostname !== "lab.anam.ai" ||
          ![`/api/avatars/${id}/image/landscape`, `/api/avatars/${id}/image/portrait`].includes(url.pathname) ||
          url.search && !/^\?v=[a-f0-9]{8,64}$/i.test(url.search)) return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export class WorkspaceStockCatalog {
  private anamFaces?: { key: string; expires: number; result: Promise<StockList<Face>> };

  constructor(
    private request: typeof fetch = fetch,
    private keys = () => ({ anam: process.env.ANAM_API_KEY, tavus: process.env.TAVUS_API_KEY }),
    private tavus = stockCatalog,
    private voices = voiceCatalog,
    private now = Date.now,
  ) {}

  async listFaces(provider: VoiceProviderId): Promise<StockList<Face>> {
    const key = this.keys()[provider];
    if (!key) return { status: "unconfigured", items: [] };
    if (provider === "tavus") {
      try {
        const entries = await this.tavus.list(key);
        const items = entries.map(({ id, name, thumbnailUrl }) =>
          ({ id, name, thumbnailUrl: publicImage(thumbnailUrl, provider, id), selection: "supported" as const }));
        return { status: "available", items };
      } catch {
        return { status: "unavailable", items: [] };
      }
    }
    const fingerprint = createHash("sha256").update(key).digest("hex");
    if (this.anamFaces?.key === fingerprint && this.anamFaces.expires > this.now()) return this.anamFaces.result;
    const result = this.loadAnamFaces(key).catch((): StockList<Face> => ({ status: "unavailable", items: [] }));
    const cache = { key: fingerprint, expires: Infinity, result };
    this.anamFaces = cache;
    const list = await result;
    cache.expires = this.now() + (list.status === "available" ? 300_000 : 30_000);
    return list;
  }

  private async loadAnamFaces(key: string): Promise<StockList<Face>> {
    const items = new Map<string, Face>();
    for await (const rows of stockCatalogPages(this.request, "anam", "https://api.anam.ai/v1/avatars", key)) {
      for (const row of rows) {
        // The documented explicit null identifies stock. A missing field does
        // not, and no related persona or account media may enter this catalog.
        if (row.createdByOrganizationId !== null || typeof row.id !== "string" ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.id) ||
            typeof row.displayName !== "string" || !row.displayName.trim() ||
            row.displayName.length > 200 || /[\u0000-\u001f\u007f]/.test(row.displayName)) continue;
        items.set(row.id, {
          id: row.id, name: row.displayName.trim(), selection: "browse_only",
          thumbnailUrl: row.imageUrlsExpireAt === null
            ? publicImage(row.imageUrl, "anam", row.id) : null,
        });
      }
    }
    return { status: "available", items: [...items.values()] };
  }

  async listVoices(provider: VoiceProviderId) {
    try {
      const { status, voices } = await this.voices.listStock(provider);
      const items = voices.map(({ id, name, gender, genderSource, languages, available }) => ({
        id, name, gender, genderSource, languages,
        // Anam's workspace listing can span more pages than the existing
        // RoleplayX-facing admission catalog. Browsing does not extend admission.
        selection: (provider === "tavus" && available && gender !== "unclassified" ? "supported" : "browse_only") as Selection,
      }));
      return { status, items };
    } catch {
      return { status: "unavailable" as const, items: [] };
    }
  }
}

export const workspaceStockCatalog = new WorkspaceStockCatalog();
