import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { sourceBuildId } from "./runtime-build";

type Call = "gemini_generate" | "provider_create";
type Stage = "attempt" | "image_preparation" | "gemini_generate" | "provider_create" | "provider_status" | "provider_delete" | "persistence";
type Event = "started" | "completed" | "failed" | "skipped" | "call_started" | "call_returned" | "call_failed" | "call_blocked" | "finished";
type Operation = "create" | "status" | "delete";
type Context = { assetId: string; provider: "anam" | "tavus"; operation: Operation };
type ModelSelection = { source: string; imageModel: string };
export type ProvisioningAuditEntry = {
  service: "provisioning_audit"; attemptId: string; assetId: string;
  provider: "anam" | "tavus"; operation: Operation; sourceBuildId: string;
  sequence: number; stage: Stage; event: Event; elapsedMs: number;
  geminiCallsStarted: number; providerCreatesStarted: number;
  geminiCallLimit: 1; providerCreateLimit: 1;
  aiSource?: "direct" | "replit" | "unconfigured";
  imageModel?: string;
};
type Sink = (entry: ProvisioningAuditEntry) => void;
type Audit = {
  context: Context; attemptId: string; started: number; sequence: number;
  calls: Record<Call, number>; sink: Sink;
};
const storage = new AsyncLocalStorage<Audit>();
const defaultSink: Sink = entry => { logger.info(entry, "Custom avatar provisioning audit"); };

function emit(audit: Audit, stage: Stage, event: Event, selection?: ModelSelection) {
  // Construct the allowlist explicitly. Never spread request, response or error objects.
  const entry: ProvisioningAuditEntry = {
    service: "provisioning_audit", attemptId: audit.attemptId,
    assetId: /^[a-zA-Z0-9_-]{1,80}$/.test(audit.context.assetId) ? audit.context.assetId : "invalid",
    provider: audit.context.provider, operation: audit.context.operation, sourceBuildId,
    sequence: ++audit.sequence, stage, event,
    elapsedMs: Math.max(0, Math.round(performance.now() - audit.started)),
    geminiCallsStarted: audit.calls.gemini_generate, providerCreatesStarted: audit.calls.provider_create,
    geminiCallLimit: 1, providerCreateLimit: 1,
  };
  if (selection) {
    entry.aiSource = selection.source === "direct" || selection.source === "replit" ? selection.source : "unconfigured";
    entry.imageModel = /^gemini-[a-zA-Z0-9.-]{1,100}$/.test(selection.imageModel) ? selection.imageModel : "invalid";
  }
  // Logging failure must not lose provider IDs, change cleanup, or trigger retries.
  try { audit.sink(entry); } catch { /* Best-effort telemetry only. */ }
}

export async function withProvisioningAudit<T>(context: Context, work: () => Promise<T>, sink: Sink = defaultSink): Promise<T> {
  const audit: Audit = {
    context: { assetId: context.assetId, provider: context.provider, operation: context.operation },
    attemptId: randomUUID(), started: performance.now(), sequence: 0,
    calls: { gemini_generate: 0, provider_create: 0 }, sink,
  };
  return storage.run(audit, async () => {
    emit(audit, "attempt", "started");
    try { return await work(); }
    finally { emit(audit, "attempt", "finished"); }
  });
}

export function auditProvisioningStage(stage: Stage, event: "started" | "completed" | "failed" | "skipped") {
  const audit = storage.getStore();
  if (audit) emit(audit, stage, event);
}

/** Counts application invocations, not provider billing or physical network delivery. */
export async function auditedProvisioningCall<T>(kind: Call, work: () => Promise<T>, selection?: ModelSelection): Promise<T> {
  const audit = storage.getStore();
  if (!audit) return work();
  if (audit.calls[kind] >= 1) {
    emit(audit, kind, "call_blocked", selection);
    throw new Error("PROVISIONING_CALL_LIMIT_EXCEEDED");
  }
  audit.calls[kind]++;
  emit(audit, kind, "call_started", selection);
  try {
    const result = await work();
    // Returned means an invocation resolved, not that the provider accepted creation.
    emit(audit, kind, "call_returned", selection);
    return result;
  } catch (error) {
    emit(audit, kind, "call_failed", selection);
    throw error;
  }
}
