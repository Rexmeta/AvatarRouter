import { z } from "zod";

export async function readCatalogJson(response: Response): Promise<unknown> {
  const limit = 2_000_000;
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > limit || !response.body) {
    throw new Error("invalid_catalog_response");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("body_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
}

const rows = z.array(z.record(z.string(), z.unknown())).max(100);
const pageSize = 100;
const maxPages = 25;
const totalCount = z.number().int().min(0).max(pageSize * maxPages);
const anamPage = z.object({
  data: rows,
  meta: z.object({
    total: totalCount, currentPage: z.number().int().positive(),
    lastPage: z.number().int().min(0).max(maxPages),
  }),
});
const tavusPage = z.object({ data: rows, total_count: totalCount });

// Pagination must positively verify completeness; a truncated page is not a
// verified empty catalog. The timeout covers all pages, including their bodies.
export async function* stockCatalogPages(request: typeof fetch, provider: "tavus" | "anam",
  endpoint: string, key: string, filters: Record<string, string> = {}) {
  const signal = AbortSignal.timeout(20_000);
  let total: number | undefined;
  let seen = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ ...filters, page: String(page), [provider === "tavus" ? "limit" : "perPage"]: String(pageSize) }).toString();
    const data = await readCatalogJson(await request(url, {
      method: "GET", redirect: "error", signal,
      headers: provider === "tavus" ? { "x-api-key": key } : { Authorization: `Bearer ${key}` },
    }));
    const a = provider === "anam" ? anamPage.parse(data) : null;
    const t = a === null ? tavusPage.parse(data) : null;
    const batch = a?.data ?? t!.data;
    const reported = a?.meta.total ?? t!.total_count;
    if (a && (a.meta.currentPage !== page || a.meta.lastPage !== Math.ceil(reported / pageSize) &&
      !(reported === 0 && a.meta.lastPage === 1))) throw new Error("invalid_catalog_page");
    if (total !== undefined && reported !== total) throw new Error("changing_catalog");
    total = reported;
    seen += batch.length;
    if (seen > total || seen < total && batch.length !== pageSize) throw new Error("incomplete_catalog");
    yield batch;
    if (seen === total) return;
  }
  throw new Error("incomplete_catalog");
}
