import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { GenerateContentResponse } from "@google/genai";
import {
  auditedProvisioningCall, auditProvisioningStage, withProvisioningAudit,
  type ProvisioningAuditEntry, type ProvisioningAuditStore,
} from "./provisioning-audit";
import { scheduleProvisioningAttemptPrune } from "./provisioning-attempt-retention";
import { ensureTrainingPortrait } from "./gemini-training-image";
import { ImageProviderAdapter } from "./provisioning-providers";
import { sourceBuildId } from "./runtime-build";

const context = { assetId: "fixture-asset", provider: "anam" as const, operation: "create" as const };
test("retention cleanup errors are swallowed and left for background retry", async () => {
  let attempted = false;
  await scheduleProvisioningAttemptPrune(async () => {
    attempted = true;
    throw Error("private database detail");
  }, Date.now() + 2 * 24 * 60 * 60 * 1000);
  assert.equal(attempted, true);
});

test("one attempt links sequential stage events, model selection and bounded invocation counters", async () => {
  const entries: ProvisioningAuditEntry[] = [];
  await withProvisioningAudit(context, async () => {
    await auditProvisioningStage("image_preparation", "started");
    await auditedProvisioningCall("gemini_generate", async () => "image", { source: "direct", imageModel: "gemini-3.1-flash-image" });
    await auditProvisioningStage("image_preparation", "completed");
    await auditedProvisioningCall("provider_create", async () => "resource");
    await auditProvisioningStage("persistence", "completed");
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
    assert.equal(entries.filter(e => e.event === "call_result_unknown").length, 1);
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

function memoryAuditStore(failUpdate?: (patch: Record<string, unknown>) => boolean) {
  const rows = new Map<string, Record<string, unknown>>();
  const store: ProvisioningAuditStore = {
    create: async record => { rows.set(record.attemptId, { ...record }); },
    update: async (attemptId, patch) => {
      if (failUpdate?.(patch as Record<string, unknown>)) throw Error("private database error");
      const current = rows.get(attemptId);
      if (!current) throw Error("missing audit row");
      rows.set(attemptId, { ...current, ...patch });
    },
  };
  return { store, rows };
}

test("durable call reservation and dispatch marker exist before work; an interrupted result stays unknown", async () => {
  const { store, rows } = memoryAuditStore();
  let startedAtDispatch = false;
  const sink: (entry: ProvisioningAuditEntry) => void = () => { throw Error("log sink unavailable"); };
  await withProvisioningAudit(context, async () => {
    await assert.rejects(auditedProvisioningCall("provider_create", async () => {
      const attempt = [...rows.values()][0]!;
      assert.equal(attempt.providerCreateCallState, "started");
      assert.equal(attempt.providerCreatesStarted, 1);
      startedAtDispatch = true;
      throw Error("simulated lost transport response");
    }));
  }, { store, sink });
  const row = [...rows.values()][0]!;
  assert.equal(startedAtDispatch, true);
  assert.equal(row.providerCreateCallState, "result_unknown");
  assert.equal(row.state, "result_unknown");
  assert.equal(row.providerCreatesStarted, 1);
  assert.doesNotMatch(JSON.stringify(row), /simulated lost transport response|private database error/);
});

test("audit write failure before dispatch blocks the call without claiming it started", async () => {
  const { store, rows } = memoryAuditStore(patch => patch.event === "call_reserved");
  let invoked = 0;
  await withProvisioningAudit(context, async () => {
    await assert.rejects(auditedProvisioningCall("gemini_generate", async () => { invoked++; }),
      /PROVISIONING_AUDIT_UNAVAILABLE/);
  }, { store });
  const row = [...rows.values()][0]!;
  assert.equal(invoked, 0);
  assert.equal(row.geminiCallsStarted, 0);
  assert.equal(row.geminiCallState, "not_started");
});
