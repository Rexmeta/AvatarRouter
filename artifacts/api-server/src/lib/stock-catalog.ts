import { createHash } from "node:crypto";
import { SessionProblem } from "./session-service";
import { stockReference, stockFaceId } from "./stock-reference";
import { STOCK_AVATAR } from "./stock-policy";

type StockEntry = {
  id: string; providerId: string; name: string; description: string; kind: "configured"; configured: boolean;
  languages: string[]; thumbnailUrl: string | null; previewVideoUrl: string | null; model: string; stock: true;
};
const safeUrl = (value: unknown) => {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && u.hostname === "cdn.replica.tavus.io" && !u.username && !u.password && !u.port ? u.href : null;
  } catch { return null; }
};
export class StockCatalog {
  private cached?: { key: string; until: number; entries: StockEntry[] };
  private pending?: { key: string; result: Promise<StockEntry[]> };
  constructor(private request: typeof fetch = fetch, private now = () => Date.now()) {}
  async list(key = process.env.TAVUS_API_KEY): Promise<StockEntry[]> {
    if (!key) return [];
    const fingerprint = createHash("sha256").update(key).digest("hex");
    if (this.cached?.key === fingerprint && this.cached.until > this.now()) return this.cached.entries;
    if (this.pending?.key === fingerprint) return this.pending.result;
    const result = this.load(key).then(entries => {
      this.cached = { key: fingerprint, until: this.now() + 300_000, entries }; return entries;
    }).finally(() => { if (this.pending?.result === result) this.pending = undefined; });
    this.pending = { key: fingerprint, result };
    return result;
  }
  private async load(key: string) {
    const entries = new Map<string, StockEntry>();
    try {
      let received = 0;
      for (let page = 1; page <= 5; page++) {
        const r = await this.request(`https://tavusapi.com/v2/faces?face_type=system&verbose=true&limit=100&page=${page}`, {
          method: "GET", headers: { "x-api-key": key }, redirect: "error", signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) throw Error("Catalog rejected");
        const text = await r.text();
        if (text.length > 2_000_000) throw Error("Catalog too large");
        const data = JSON.parse(text) as { data?: Record<string, unknown>[]; total_count?: number };
        if (!Array.isArray(data.data) || data.data.length > 100 || !Number.isSafeInteger(data.total_count) || data.total_count! < 0 || data.total_count! > 500) throw Error("Invalid pagination");
        received += data.data.length;
        for (const face of data.data) {
          if (face.face_type !== "system" || face.status !== "completed" || face.available_for_plan !== true ||
            typeof face.face_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(face.face_id) || typeof face.face_name !== "string") continue;
          entries.set(face.face_id, {
            id: stockReference(face.face_id), providerId: "tavus", name: face.face_name.slice(0, 200),
            description: "Provider-listed stock avatar. No training required; playback and credits are not verified by catalog selection.",
            kind: "configured", configured: true, languages: [], thumbnailUrl: safeUrl(face.thumbnail_image_url),
            previewVideoUrl: safeUrl(face.thumbnail_video_url), model: String(face.model_name ?? "unknown").slice(0, 50), stock: true,
          });
        }
        if (received >= data.total_count!) return [...entries.values()];
        if (!data.data.length) throw Error("Incomplete pagination");
      }
      throw Error("Incomplete pagination");
    } catch {
      throw new SessionProblem(503, "STOCK_CATALOG_UNAVAILABLE", "Could not verify the provider stock catalog. Refresh later; no paid session was created.");
    }
  }
}
export const stockCatalog = new StockCatalog();
export async function requireStockAvatar(id: string) {
  stockFaceId(id); // Reject malformed namespaces before any upstream call.
  if (id === STOCK_AVATAR) return; // Backward-compatible default and existing stored sessions.
  if (!(await stockCatalog.list()).some(a => a.id === id)) throw new SessionProblem(409, "STOCK_AVATAR_UNAVAILABLE", "This avatar is not in the available stock catalog. Refresh and select an available entry.");
}
