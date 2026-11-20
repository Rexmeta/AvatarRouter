import { test } from "node:test";
import assert from "node:assert/strict";
import express, { type ErrorRequestHandler } from "express";
import developerRoutes from "../routes/developer-keys";
import { createWorkspaceStockRoutes } from "../routes/workspace-stock-catalog";
import { SessionProblem } from "./session-service";
import { StockCatalog } from "./stock-catalog";
import { VoiceCatalog } from "./voice-catalog";
import { WorkspaceStockCatalog } from "./workspace-stock-catalog";

const faceId = "a1000000-0000-4000-8000-000000000001";
const imageUrl = `https://lab.anam.ai/api/avatars/${faceId}/image/landscape?v=3f2a1b0c9d8e7f6a`;
const keys = () => ({ tavus: "tavus-test-key", anam: "anam-test-key" });
const json = (data: unknown, status = 200) => Response.json(data, { status });
const page = (data: unknown[], current = 1, total = data.length) =>
  json({ data, meta: { currentPage: current, lastPage: Math.max(1, Math.ceil(total / 100)), total } });

test("stock browsing filters private items and media, reuses classifications and isolates partial failure", async () => {
  let writes = 0;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    if (url.pathname === "/v1/avatars") {
      return page([
        { id: faceId, displayName: "Stock Anam", createdByOrganizationId: null, imageUrl, imageUrlsExpireAt: null, videoUrl: "private" },
        { id: "b1000000-0000-4000-8000-000000000002", displayName: "No public preview", createdByOrganizationId: null,
          imageUrl: `${imageUrl}&signature=private`, imageUrlsExpireAt: "2026-11-20T00:00Z" },
        { id: "c1000000-0000-4000-8000-000000000003", displayName: "Custom face", createdByOrganizationId: "private-org" },
        { id: "d1000000-0000-4000-8000-000000000004", displayName: "Unverified" },
      ]);
    }
    if (url.pathname === "/v1/voices") return json({ details: "do not expose" }, 503);
    if (url.pathname === "/v2/faces") {
      assert.equal(url.searchParams.get("face_type"), "system");
      const base = { status: "completed", available_for_plan: true, face_type: "system" };
      const rows = [
        { ...base, face_id: "face-public", face_name: "Stock Tavus", thumbnail_image_url: "https://cdn.replica.tavus.io/good.jpg" },
        { ...base, face_id: "face-signed", face_name: "Read without thumbnail", thumbnail_image_url: "https://cdn.replica.tavus.io/img.jpg?signature=private" },
        { ...base, face_id: "face-private", face_name: "Private Tavus", face_type: "user" },
        { ...base, face_id: "face-other-plan", face_name: "Not entitled", available_for_plan: false },
      ];
      return json({ data: rows, total_count: rows.length });
    }
    assert.equal(url.pathname, "/v2/voices");
    assert.equal(url.searchParams.get("source"), "system");
    const rows = [
      { voice_id: "voice-1", voice_name: "Stock voice", voice_type: "system", gender: "male", languages: ["ko", "en", "ko"], sampleUrl: "private" },
      { voice_id: "voice-2", voice_name: "Unclassified voice", voice_type: "system" },
      { voice_id: "voice-3", voice_name: "Account voice", voice_type: "user" },
      { voice_id: "voice-4", voice_name: "Unverified voice" },
    ];
    return json({ data: rows, total_count: rows.length });
  };
  const voices = new VoiceCatalog(request, Date.now, {
    list: async () => [{ providerId: "tavus", voiceId: "voice-1", gender: "female" }],
    set: async () => { writes++; },
  }, keys);
  const catalog = new WorkspaceStockCatalog(request, keys, new StockCatalog(request), voices);
  const [af, av, tf, tv] = await Promise.all([
    catalog.listFaces("anam"), catalog.listVoices("anam"), catalog.listFaces("tavus"), catalog.listVoices("tavus"),
  ]);
  assert.deepEqual(av, { status: "unavailable", items: [] });
  assert.deepEqual(af.items.map(f => [f.name, f.thumbnailUrl, f.selection]), [
    ["Stock Anam", imageUrl, "browse_only"], ["No public preview", null, "browse_only"],
  ]);
  assert.deepEqual(tf.items.map(f => [f.name, f.thumbnailUrl, f.selection]), [
    ["Stock Tavus", "https://cdn.replica.tavus.io/good.jpg", "supported"], ["Read without thumbnail", null, "supported"],
  ]);
  assert.deepEqual(tv.items, [
    { id: "voice-1", name: "Stock voice", gender: "female", genderSource: "admin", languages: ["ko", "en"], selection: "supported" },
    { id: "voice-2", name: "Unclassified voice", gender: "unclassified", genderSource: "unknown", languages: [], selection: "browse_only" },
  ]);
  assert.doesNotMatch(JSON.stringify({ af, av, tf, tv }), /private|secret|key|sampleUrl|videoUrl/i);
  assert.equal(writes, 0);
});

test("long Anam stock voice lists paginate without changing the integration admission catalog", async () => {
  let stockPages = 0;
  let fail = false;
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    const number = Number(url.searchParams.get("page"));
    stockPages++;
    const count = number <= 10 ? 100 : 2;
    const items = Array.from({ length: count }, (_, i) => ({
      id: `voice-${number}-${i}`, displayName: "Voice", languages: ["en"], gender: "FEMALE",
      createdByOrganizationId: i === 1 ? "org-private" : i === 2 ? undefined : null,
    }));
    return fail ? page(items, number + 1, 1002) : page(items, number, 1002);
  };
  let clock = 1;
  const credentials = () => ({ anam: "test", tavus: undefined });
  const voices = new VoiceCatalog(request, () => clock, { list: async () => [], set: async () => {} }, credentials);
  const catalog = new WorkspaceStockCatalog(request, credentials, new StockCatalog(request), voices);
  const stock = await catalog.listVoices("anam");
  assert.equal(stock.status, "available");
  assert.equal(stockPages, 11);
  assert.equal(stock.items.length, 981);
  assert.equal(stock.items.at(-1)?.id, "voice-11-0");
  assert.equal(stock.items[0]?.genderSource, "provider");
  assert.ok(stock.items.every(x => x.selection === "browse_only"));
  await assert.rejects(voices.requireSelection("anam", "voice-1-0"), { code: "VOICE_CATALOG_UNAVAILABLE" });
  assert.equal(stockPages, 21);
  assert.deepEqual(await catalog.listFaces("tavus"), { status: "unconfigured", items: [] });
  clock += 310_000;
  fail = true;
  assert.deepEqual(await catalog.listVoices("anam"), { status: "unavailable", items: [] });
});

test("a verified empty stock catalog is not an upstream failure", async () => {
  const request: typeof fetch = async input => String(input).includes("api.anam.ai") ? page([]) : json({ data: [], total_count: 0 });
  const voices = new VoiceCatalog(request, Date.now, { list: async () => { throw new Error("not needed for empty"); }, set: async () => {} }, keys);
  const catalog = new WorkspaceStockCatalog(request, keys, new StockCatalog(request), voices);
  for (const provider of ["anam", "tavus"] as const) {
    const empty = { status: "available", items: [] };
    assert.deepEqual(await catalog.listFaces(provider), empty);
    assert.deepEqual(await catalog.listVoices(provider), empty);
  }
});

test("developer route rejects anonymous and project keys; catalog lookup follows exact ownership", async () => {
  const app = express();
  app.use((req, res, next) => {
    if (req.get("x-test-key")) res.locals.serviceApiIdentity = { tenantId: "test", scopes: ["assets:read"] };
    Object.assign(req, {
      auth: Object.assign(() => ({ userId: req.get("x-test-user") || null, tokenType: "session_token" }),
        { [Symbol.for("@clerk/express.auth")]: true }),
    });
    next();
  });
  const catalogReads: string[] = [];
  const route = createWorkspaceStockRoutes(async (userId, projectId) => {
    if (userId !== "owner" || projectId !== faceId) throw new SessionProblem(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }, {
    listFaces: async p => { catalogReads.push(`${p}:faces`); return { status: "available", items: [] }; },
    listVoices: async p => { catalogReads.push(`${p}:voices`); return { status: "unavailable", items: [] }; },
  });
  app.use("/actual", developerRoutes);
  app.use("/fixture", route);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error instanceof SessionProblem ? error.status : 500).end(); };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const get = (router: string, tail: string, headers?: Record<string, string>) =>
      fetch(`http://127.0.0.1:${address.port}/${router}/v1/developer/workspaces/${faceId}/stock-catalog/${tail}`, { headers });
    assert.equal((await get("actual", "tavus/faces")).status, 401);
    assert.equal((await get("actual", "tavus/voices", { "x-test-key": "service" })).status, 403);
    assert.equal((await get("fixture", "anam/faces", { "x-test-user": "other" })).status, 404);
    assert.equal((await get("fixture", "unexpected/faces", { "x-test-user": "owner" })).status, 404);
    assert.deepEqual(catalogReads, []);
    const faces = await get("fixture", "tavus/faces", { "x-test-user": "owner" });
    const voices = await get("fixture", "anam/voices", { "x-test-user": "owner" });
    assert.equal(faces.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await faces.json(), { status: "available", items: [] });
    assert.deepEqual(await voices.json(), { status: "unavailable", items: [] });
    assert.deepEqual(catalogReads, ["tavus:faces", "anam:voices"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
