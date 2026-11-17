import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { GenerateContentResponse } from "@google/genai";
import { auditedProvisioningCall, auditProvisioningStage, withProvisioningAudit, type ProvisioningAuditEntry } from "./provisioning-audit";
import { ensureTrainingPortrait } from "./gemini-training-image";
import { ImageProviderAdapter } from "./provisioning-providers";
import { sourceBuildId } from "./runtime-build";

const context = { assetId: "fixture-asset", provider: "anam" as const, operation: "create" as const };
test("one attempt links sequential stage events, model selection and bounded invocation counters", async () => {
  const entries: ProvisioningAuditEntry[] = [];
  await withProvisioningAudit(context, async () => {
    auditProvisioningStage("image_preparation", "started");
    await auditedProvisioningCall("gemini_generate", async () => "image", { source: "direct", imageModel: "gemini-3.1-flash-image" });
    auditProvisioningStage("image_preparation", "completed");
    await auditedProvisioningCall("provider_create", async () => "resource");
    auditProvisioningStage("persistence", "completed");
  }, entry => { entries.push(entry); });
  assert.equal(new Set(entries.map(e => e.attemptId)).size, 1);
  assert.equal(entries[0]!.event, "started");
  assert.equal(entries.at(-1)!.event, "finished");
  assert.deepEqual(entries.map(e => e.sequence), entries.map((_, i) => i + 1));
  assert.equal(entries.at(-1)!.geminiCallsStarted, 1);
  assert.equal(entries.at(-1)!.providerCreatesStarted, 1);
  assert.ok(entries.every(e => e.sourceBuildId === sourceBuildId && e.geminiCallLimit === 1 && e.providerCreateLimit === 1));
  assert.equal(entries.find(e => e.stage === "gemini_generate")!.aiSource, "direct");
});

test("failed paid calls are counted once, never retried, and a second invocation is blocked", async () => {
  for (const kind of ["gemini_generate", "provider_create"] as const) {
    const entries: ProvisioningAuditEntry[] = [];
    let calls = 0;
    await withProvisioningAudit(context, async () => {
      await assert.rejects(auditedProvisioningCall(kind, async () => {
        calls++; throw Error("private upstream content");
      }));
      await assert.rejects(auditedProvisioningCall(kind, async () => { calls++; }), /CALL_LIMIT_EXCEEDED/);
    }, e => { entries.push(e); });
    assert.equal(calls, 1);
    assert.equal(entries.filter(e => e.event === "call_failed").length, 1);
    assert.equal(entries.filter(e => e.event === "call_blocked").length, 1);
    assert.doesNotMatch(JSON.stringify(entries), /private upstream content/);
  }
});

test("overlapping assets and explicit subsequent attempts never share IDs or counters", async () => {
  const entries: ProvisioningAuditEntry[] = [];
  await Promise.all(["asset-a", "asset-b"].map(assetId => withProvisioningAudit({ ...context, assetId }, async () => {
    await auditedProvisioningCall("gemini_generate", async () => { await new Promise(resolve => setImmediate(resolve)); });
    await auditedProvisioningCall("provider_create", async () => undefined);
  }, e => { entries.push(e); })));
  await withProvisioningAudit({ ...context, assetId: "asset-a" }, async () => {}, e => { entries.push(e); });
  assert.equal(new Set(entries.map(e => e.attemptId)).size, 3);
  const finished = entries.filter(e => e.event === "finished");
  assert.deepEqual(finished.map(e => e.geminiCallsStarted).sort(), [0, 1, 1]);
  for (const id of new Set(entries.map(e => e.attemptId))) {
    assert.equal(new Set(entries.filter(e => e.attemptId === id).map(e => e.assetId)).size, 1);
  }
});

test("logging failure and sensitive extra fields cannot affect work or enter the audit", async () => {
  let invoked = 0;
  const noisy = { ...context, authorization: "private-key", image: "private-image", sourceUrl: "https://private.invalid" };
  const entries: ProvisioningAuditEntry[] = [];
  await withProvisioningAudit(noisy, async () => {
    await auditedProvisioningCall("gemini_generate", async () => { invoked++; return { secret: "private-response" }; },
      { source: "https://private-billing.invalid", imageModel: "https://private-model.invalid" });
  }, entry => { entries.push(entry); throw Error("logging unavailable"); });
  assert.equal(invoked, 1);
  assert.doesNotMatch(JSON.stringify(entries), /private-|authorization|sourceUrl/);
  assert.equal(entries.find(e => e.event === "call_started")!.imageModel, "invalid");
  assert.equal(entries.find(e => e.event === "call_started")!.aiSource, "unconfigured");
});

test("real generation and adapter boundaries report one invocation without payloads or provider IDs", async () => {
  const entries: ProvisioningAuditEntry[] = [];
  const image = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#777" } }).png().toBuffer();
  let generated = 0, posted = 0;
  await withProvisioningAudit(context, async () => {
    await ensureTrainingPortrait(image, async bytes => bytes, async () => {
      generated++;
      return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: image.toString("base64") } }] } }] } as GenerateContentResponse;
    }, { assetId: context.assetId, provider: "anam" });
    const adapter = new ImageProviderAdapter("anam", async () => {
      posted++;
      return Response.json({ id: "private-provider-id" });
    }, () => "private-credential");
    await adapter.create("private-persona", "https://private-training.invalid", "private-voice");
  }, entry => { entries.push(entry); });
  assert.equal(generated, 1); assert.equal(posted, 1);
  assert.equal(entries.at(-1)!.geminiCallsStarted, 1);
  assert.equal(entries.at(-1)!.providerCreatesStarted, 1);
  assert.doesNotMatch(JSON.stringify(entries), /private-|inlineData|base64|contents/);
});

test("absent credentials never count as a provider transport invocation", async () => {
  const entries: ProvisioningAuditEntry[] = [];
  await withProvisioningAudit(context, async () => {
    const adapter = new ImageProviderAdapter("anam", async () => assert.fail(), () => undefined);
    await assert.rejects(adapter.create("fixture", "https://example.invalid", "fixture"), { code: "PROVIDER_NOT_CONFIGURED" });
  }, entry => { entries.push(entry); });
  assert.equal(entries.at(-1)!.providerCreatesStarted, 0);
});
