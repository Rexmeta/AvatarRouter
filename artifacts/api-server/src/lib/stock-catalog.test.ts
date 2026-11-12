import test from "node:test";
import assert from "node:assert/strict";
import { StockCatalog } from "./stock-catalog";
import { sessionFace, stockReference } from "./stock-reference";
import { fullPalBody, fullConversationBody } from "./tavus-full-runtime";
const face = (id: string, extra: object = {}) => ({
  face_id: id, face_name: id, face_type: "system", status: "completed", available_for_plan: true,
  thumbnail_image_url: "https://cdn.replica.tavus.io/public.jpg", thumbnail_video_url: "https://cdn.replica.tavus.io/public.mp4",
  model_name: "phoenix-4.5", ...extra,
});
test("all pages load, only completed entitled system stock is exposed, and images are safe", async () => {
  let calls = 0;
  const c = new StockCatalog(async (url, init) => {
    calls++;
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
    assert.match(String(url), /face_type=system/);
    return Response.json({ data: calls === 1 ? [face("r4067604db72"), face("rLucas")] : [
      face("rUser", { face_type: "user" }), face("rLocked", { available_for_plan: false }),
      face("rPending", { status: "started" }), face("rOther", { thumbnail_image_url: "http://127.0.0.1/private" }),
    ], total_count: 6 });
  });
  const a = await c.list("fixture");
  assert.equal(calls, 2); assert.equal(a.length, 3);
  assert.equal(a[0]!.id, "tavus-stock-lucy");
  assert.equal(a[1]!.id, "tavus-stock-rLucas");
  assert.equal(a[1]!.thumbnailUrl, "https://cdn.replica.tavus.io/public.jpg");
  assert.equal(a[2]!.thumbnailUrl, null);
  assert.ok(a.every(x => x.stock && x.configured));
});
test("parallel reads share one request; cache expires and credential rotation invalidates it", async () => {
  let calls = 0, now = 0;
  const c = new StockCatalog(async () => { calls++; return Response.json({ data: [face("rFace")], total_count: 1 }); }, () => now);
  await Promise.all([c.list("a"), c.list("a"), c.list("a")]); assert.equal(calls, 1);
  now = 299999; await c.list("a"); assert.equal(calls, 1);
  now = 300001; await c.list("a"); assert.equal(calls, 2);
  await c.list("b"); assert.equal(calls, 3);
});
test("upstream errors and malformed pagination fail explicitly, never fabricate a one-avatar free catalog", async () => {
  for (const r of [Response.json({ secret: "private-message" }, { status: 401 }),
    Response.json({ data: [], total_count: 12 }), Response.json({ data: [], total_count: 10000 })]) {
    await assert.rejects(new StockCatalog(async () => r).list("fixture"), e => {
      assert.equal((e as { code: string }).code, "STOCK_CATALOG_UNAVAILABLE");
      assert.doesNotMatch(String(e), /private-message/); return true;
    });
  }
});
test("selected stock face is preserved in renderer, full PAL and conversation; legacy and custom references stay distinct", () => {
  const row = { providerId: "tavus", avatarId: stockReference("rLucas"), avatarAssetId: null };
  assert.equal(sessionFace(row), "rLucas");
  assert.equal(fullPalBody("id", sessionFace(row), { systemPrompt: "fixture" }).default_face_id, "rLucas");
  assert.equal(fullConversationBody("id", sessionFace(row), "pal", { systemPrompt: "fixture" }, 600).face_id, "rLucas");
  assert.equal(sessionFace({ ...row, avatarId: "tavus-stock-lucy" }), "r4067604db72");
  assert.equal(sessionFace({ ...row, avatarId: "custom-face", avatarAssetId: "owned-uuid" }), "custom-face");
  assert.throws(() => sessionFace({ ...row, avatarId: "unlisted-raw-face" }), { code: "LIVE_TARGET_UNSUPPORTED" });
});
