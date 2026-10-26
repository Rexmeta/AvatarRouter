import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { validateImage, decodeImageBase64, publicAddress, hashImage, MAX_IMAGE_BYTES, fetchAuthorizedImage } from "./image-validation";
import { ImageProviderAdapter, ProviderFailure, requireSupportedProvider } from "./provisioning-providers";
import { provisioningOutcome } from "./provisioning-worker";

test("fully decodes supported images, strips metadata, preserves original hash", async () => {
  const png = await sharp({ create: { width: 128, height: 256, channels: 3, background: "#507070" } }).png().toBuffer();
  const result = await validateImage(png);
  assert.equal(result.width, 128); assert.equal(result.height, 256);
  assert.equal(result.contentHash, hashImage(png));
  assert.equal((await sharp(result.bytes).metadata()).format, "jpeg");
  assert.equal((await sharp(result.bytes).metadata()).exif, undefined);
});
test("rejects spoofed, oversized, undersized and vector images", async () => {
  for (const bytes of [Buffer.from("not a PNG"), Buffer.alloc(MAX_IMAGE_BYTES + 1), Buffer.from('<svg width="128" height="128"></svg>'), await sharp({ create: { width: 32, height: 32, channels: 3, background: "#000" } }).png().toBuffer()]) {
    await assert.rejects(validateImage(bytes));
  }
});
test("strict base64 and SSRF checks reject URL credentials, localhost and non-allowlisted hosts", async () => {
  assert.throws(() => decodeImageBase64("data:image/png;base64,abcd"));
  assert.equal(decodeImageBase64("YWJj").toString(), "abc");
  for (const ip of ["127.0.0.1", "::1", "10.1.1.1", "169.254.169.254", "192.168.1.1", "::ffff:127.0.0.1", "fe80::1", "100.64.0.1"]) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  await assert.rejects(fetchAuthorizedImage("http://localhost/a.png"));
  await assert.rejects(fetchAuthorizedImage("https://user:pass@example.com/a.png"));
});
test("capability-aware registry rejects unimplemented persistent providers", () => {
  assert.throws(() => requireSupportedProvider("lemonslice"), /not implemented/);
  assert.throws(() => requireSupportedProvider("simli"), /not implemented/);
});
test("Tavus adapter uses documented image training and poll contract", async () => {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const transport = (async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(init?.method === "POST" ? { face_id: "testface", status: "started" } : { status: "completed" });
  }) as typeof fetch;
  const adapter = new ImageProviderAdapter("tavus", transport, () => "test-placeholder");
  assert.deepEqual(await adapter.create("Fixture", "https://example.invalid/image", "anna"), { id: "testface", ready: false });
  assert.equal(await adapter.poll("testface"), "ready");
  await adapter.remove("testface");
  assert.deepEqual(calls[0]!.body, { face_name: "Fixture", train_image_url: "https://example.invalid/image", voice_name: "anna", model_name: "phoenix-4.5", auto_fix_training_image: false });
  assert.equal(calls[2]!.url, "https://tavusapi.com/v2/faces/testface?hard=true");
});
test("Anam adapter, auth failure, unknown status and ambiguous POST are explicit", async () => {
  const good = new ImageProviderAdapter("anam", (async () => Response.json({ id: "avatar-123" }, { status: 201 })) as typeof fetch, () => "test-placeholder");
  assert.equal((await good.create("Fixture", "https://example.invalid/image", "unused")).ready, true);
  const rejected = new ImageProviderAdapter("tavus", (async () => new Response("private provider error", { status: 401 })) as typeof fetch, () => "test-placeholder");
  await assert.rejects(rejected.create("Fixture", "https://example.invalid/image", "anna"), (e: unknown) => e instanceof ProviderFailure && e.code === "PROVIDER_AUTHENTICATION_FAILED" && !e.ambiguous);
  const broken = new ImageProviderAdapter("tavus", (async () => { throw new Error("socket"); }) as typeof fetch, () => "test-placeholder");
  try { await broken.create("Fixture", "https://example.invalid/image", "anna"); assert.fail(); }
  catch (e) { assert.equal(provisioningOutcome(e, true).ambiguous, true); }
});
