import type { VoiceCatalog } from "./voice-catalog";

type Catalog = Awaited<ReturnType<VoiceCatalog["list"]>>;

// Legacy RoleplayX caps upstream JSON at 256 KiB and the catalog at 1,000
// rows. Keep headroom for serialization without changing its JSON shape.
const maxBytes = 224 * 1024;

export function voiceCatalogPage(catalog: Catalog, offset: number, limit: number) {
  const { providers, voices } = catalog;
  const page: Catalog = { providers, voices: [] };
  let bytes = Buffer.byteLength(JSON.stringify(page), "utf8");
  // Give all providers a place on the first page even when a provider's
  // catalog grows. Use stable IDs, not upstream page order or localized names.
  const ordered = providers.map(({ providerId }) => voices.filter(voice => voice.providerId === providerId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const entries = [];
  const depth = Math.max(0, ...ordered.map(list => list.length));
  for (let index = 0; index < depth; index++) {
    for (const list of ordered) if (list[index]) entries.push(list[index]!);
  }
  let index = offset;
  for (; index < entries.length && page.voices.length < limit; index++) {
    const voice = entries[index]!;
    const itemBytes = Buffer.byteLength(JSON.stringify(voice), "utf8") + Number(page.voices.length > 0);
    if (bytes + itemBytes > maxBytes) break;
    page.voices.push(voice);
    bytes += itemBytes;
  }
  return { page, total: entries.length, nextOffset: index < entries.length ? index : null };
}
