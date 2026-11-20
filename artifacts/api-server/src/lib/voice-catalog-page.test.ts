import assert from "node:assert/strict";
import { test } from "node:test";
import { ListVoicesResponse } from "@workspace/api-zod";
import { voiceCatalogPage } from "./voice-catalog-page";
import type { CatalogVoice, VoiceCatalog } from "./voice-catalog";

const make = (anamCount: number, tavusCount: number, description: string): Awaited<ReturnType<VoiceCatalog["list"]>> => ({
  providers: ["anam", "tavus"].map(providerId => ({
    providerId: providerId as CatalogVoice["providerId"], status: "available", errorCode: null,
  })),
  voices: (["anam", "tavus"] as const).flatMap((providerId, n) =>
    Array.from({ length: n ? tavusCount : anamCount }, (_, i) => ({
      id: `${providerId}-${String(i).padStart(4, "0")}`, providerId, name: `음성 ${i}`, description,
      gender: "female", genderSource: "provider", languages: ["ko"], available: true,
    }))),
});

test("large catalogs keep the legacy RoleplayX byte and row fences but every entry is pageable", () => {
  const full = make(1428, 75, "한국어 ".repeat(104));
  assert.equal(ListVoicesResponse.safeParse(full).success, false);
  assert.ok(Buffer.byteLength(JSON.stringify(full)) > 262_144);
  const seen: string[] = [];
  let offset: number | null = 0;
  for (let pages = 0; offset !== null; pages++) {
    assert.ok(pages < 20);
    const output: ReturnType<typeof voiceCatalogPage> = voiceCatalogPage(full, offset, 1000);
    assert.equal(output.total, 1503);
    assert.deepEqual(output.page.providers, full.providers);
    assert.ok(ListVoicesResponse.safeParse(output.page).success);
    assert.ok(Buffer.byteLength(JSON.stringify(output.page)) < 262_144);
    if (pages === 0) {
      assert.ok(output.page.voices.some(voice => voice.providerId === "anam"));
      assert.ok(output.page.voices.some(voice => voice.providerId === "tavus"));
    }
    assert.ok(output.page.voices.length <= 1000 && output.page.voices.length > 0);
    assert.ok(output.nextOffset === null || output.nextOffset > offset);
    seen.push(...output.page.voices.map(voice => voice.id));
    offset = output.nextOffset;
  }
  assert.deepEqual([...seen].sort(), full.voices.map(voice => voice.id).sort());
});

test("small or empty catalogs, explicit limits, and unavailable providers preserve the contract", () => {
  const full = make(2, 0, "");
  full.providers[1] = { providerId: "tavus", status: "unavailable", errorCode: "VOICE_CATALOG_UNAVAILABLE" };
  assert.deepEqual(voiceCatalogPage(full, 0, 1000), { page: full, total: 2, nextOffset: null });
  assert.equal(voiceCatalogPage(full, 0, 1).nextOffset, 1);
  assert.equal(voiceCatalogPage(full, 1, 1).page.voices[0]?.id, "anam-0001");
  assert.equal(voiceCatalogPage(full, 2, 1000).page.voices.length, 0);
  assert.equal(voiceCatalogPage(make(0, 0, ""), 0, 1000).nextOffset, null);
});
