import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  db, and, desc, eq, provisioningAttempts, type InsertProvisioningAttempt,
  type ProvisioningAttemptRecord,
} from "@workspace/db";
import { logger } from "./logger";
import { sourceBuildId } from "./runtime-build";

type Call = "gemini_generate" | "provider_create";
type Stage = typeof import("@workspace/db").provisioningAttemptStages[number];
type Event = typeof import("@workspace/db").provisioningAttemptEvents[number];
type Operation = "create" | "status" | "delete";
export type ProvisioningAuditContext = { assetId: string; provider: "anam" | "tavus"; operation: Operation };
type ModelSelection = { source: string; imageModel: string };
export type ProvisioningAuditEntry = {
  service: "provisioning_audit"; attemptId: string; assetId: string;
  provider: "anam" | "tavus"; operation: Operation; sourceBuildId: string;
  sequence: number; stage: Stage; event: Event; elapsedMs: number;
  geminiCallsStarted: number; providerCreatesStarted: number;
  attemptState: "active" | "finished" | "result_unknown";
  geminiCallState: "not_started" | "reserved" | "started" | "returned" | "result_unknown";
  providerCreateCallState: "not_started" | "reserved" | "started" | "returned" | "result_unknown";
  geminiCallLimit: 1; providerCreateLimit: 1;
  aiSource?: "direct" | "replit" | "unconfigured";
  imageModel?: string;
};
type Sink = (entry: ProvisioningAuditEntry) => void;
type StorePatch = Partial<Omit<ProvisioningAttemptRecord, "attemptId" | "assetId" | "providerId" | "sourceBuildId" | "createdAt">>;
export type ProvisioningAuditStore = {
  create: (record: InsertProvisioningAttempt) => Promise<void>;
  update: (attemptId: string, patch: StorePatch) => Promise<void>;
};
export class ProvisioningAuditUnavailableError extends Error {
  constructor() { super("PROVISIONING_AUDIT_UNAVAILABLE"); }
}
type WithAuditOptions = {
  attemptId?: string;
  initiallyPersisted?: boolean;
  persist?: boolean;
  sink?: Sink;
  store?: ProvisioningAuditStore;
};
type Audit = {
  context: ProvisioningAuditContext; attemptId: string; started: number; sequence: number;
  calls: Record<Call, number>;
  callStates: Record<Call, ProvisioningAuditEntry["geminiCallState"]>;
  state: ProvisioningAuditEntry["attemptState"];
  persist: boolean; sink: Sink; store: ProvisioningAuditStore;
};
const storage = new AsyncLocalStorage<Audit>();
const defaultSink: Sink = entry => { logger.info(entry, "Custom avatar provisioning audit"); };
const defaultStore: ProvisioningAuditStore = {
  create: async record => { await db.insert(provisioningAttempts).values(record); },
  update: async (attemptId, patch) => {
    const [updated] = await db.update(provisioningAttempts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(provisioningAttempts.attemptId, attemptId))
      .returning({ attemptId: provisioningAttempts.attemptId });
    if (!updated) throw new Error("PROVISIONING_ATTEMPT_NOT_FOUND");
  },
};

export function initialProvisioningAttempt(
  context: ProvisioningAuditContext, attemptId: string = randomUUID(),
): InsertProvisioningAttempt {
  return {
    attemptId, assetId: /^[a-zA-Z0-9_-]{1,80}$/.test(context.assetId) ? context.assetId : "invalid",
    providerId: context.provider, sourceBuildId, state: "active", stage: "attempt",
    event: "started", sequence: 1, elapsedMs: 0,
    geminiCallsStarted: 0, geminiCallState: "not_started",
    providerCreatesStarted: 0, providerCreateCallState: "not_started",
  };
}

function safeSink(audit: Audit, entry: ProvisioningAuditEntry) {
  try { audit.sink(entry); } catch { /* Best-effort log output must not affect work. */ }
}

async function emit(
  audit: Audit, stage: Stage, event: Event, selection?: ModelSelection,
  options: { critical?: boolean; persist?: boolean } = {},
) {
  const calls = { ...audit.calls };
  const callStates = { ...audit.callStates };
  if (stage === "gemini_generate" || stage === "provider_create") {
    const kind: Call = stage;
    if (event === "call_reserved") callStates[kind] = "reserved";
    else if (event === "call_started") { callStates[kind] = "started"; calls[kind]++; }
    else if (event === "call_returned") callStates[kind] = "returned";
    else if (event === "call_result_unknown") callStates[kind] = "result_unknown";
  }
  const state = event === "finished"
    ? Object.values(callStates).includes("result_unknown") ? "result_unknown" : "finished"
    : event === "call_result_unknown" ? "result_unknown" : audit.state;
  // Construct the allowlist explicitly. Never spread request, response or error objects.
  const entry: ProvisioningAuditEntry = {
    service: "provisioning_audit", attemptId: audit.attemptId,
    assetId: /^[a-zA-Z0-9_-]{1,80}$/.test(audit.context.assetId) ? audit.context.assetId : "invalid",
    provider: audit.context.provider, operation: audit.context.operation, sourceBuildId,
    sequence: audit.sequence + 1, stage, event,
    elapsedMs: Math.max(0, Math.round(performance.now() - audit.started)),
    geminiCallsStarted: calls.gemini_generate, providerCreatesStarted: calls.provider_create,
    attemptState: state, geminiCallState: callStates.gemini_generate,
    providerCreateCallState: callStates.provider_create,
    geminiCallLimit: 1, providerCreateLimit: 1,
  };
  if (selection) {
    entry.aiSource = selection.source === "direct" || selection.source === "replit" ? selection.source : "unconfigured";
    entry.imageModel = /^gemini-[a-zA-Z0-9.-]{1,100}$/.test(selection.imageModel) ? selection.imageModel : "invalid";
  }
  const shouldPersist = options.persist ?? audit.persist;
  if (shouldPersist) {
    try {
      await audit.store.update(audit.attemptId, {
        state, stage, event, sequence: entry.sequence, elapsedMs: entry.elapsedMs,
        geminiCallsStarted: calls.gemini_generate, geminiCallState: callStates.gemini_generate,
        providerCreatesStarted: calls.provider_create, providerCreateCallState: callStates.provider_create,
      });
    } catch {
      // A durable pre-dispatch marker is mandatory. Post-dispatch writes are
      // best-effort so a known provider ID can still be saved and cleaned up.
      if (options.critical) throw new ProvisioningAuditUnavailableError();
    }
  }
  audit.sequence = entry.sequence;
  audit.calls = calls;
  audit.callStates = callStates;
  audit.state = state;
  safeSink(audit, entry);
}

function initialEntry(audit: Audit): ProvisioningAuditEntry {
  return {
    service: "provisioning_audit", attemptId: audit.attemptId,
    assetId: /^[a-zA-Z0-9_-]{1,80}$/.test(audit.context.assetId) ? audit.context.assetId : "invalid",
    provider: audit.context.provider, operation: audit.context.operation, sourceBuildId,
    sequence: 1, stage: "attempt", event: "started", elapsedMs: 0,
    geminiCallsStarted: 0, providerCreatesStarted: 0, attemptState: "active",
    geminiCallState: "not_started", providerCreateCallState: "not_started",
    geminiCallLimit: 1, providerCreateLimit: 1,
  };
}

export async function withProvisioningAudit<T>(
  context: ProvisioningAuditContext, work: () => Promise<T>,
  options: WithAuditOptions | Sink = {},
): Promise<T> {
  // Function-form sinks are kept for offline tests; they explicitly opt out of
  // durable writes unless a store is supplied through the options form.
  const config: WithAuditOptions = typeof options === "function" ? { sink: options, persist: false } : options;
  const persist = config.persist ?? true;
  const store = config.store ?? defaultStore;
  const audit: Audit = {
    context: { assetId: context.assetId, provider: context.provider, operation: context.operation },
    attemptId: config.attemptId ?? randomUUID(), started: performance.now(), sequence: 0,
    calls: { gemini_generate: 0, provider_create: 0 },
    callStates: { gemini_generate: "not_started", provider_create: "not_started" },
    state: "active", persist, sink: config.sink ?? defaultSink, store,
  };
  return storage.run(audit, async () => {
    if (config.initiallyPersisted) {
      audit.sequence = 1;
      safeSink(audit, initialEntry(audit));
    } else {
      const first = initialProvisioningAttempt(context, audit.attemptId);
      if (persist) {
        try { await store.create(first); }
        catch { throw new ProvisioningAuditUnavailableError(); }
      }
      audit.sequence = 1;
      safeSink(audit, initialEntry(audit));
    }
    try { return await work(); }
    finally { await emit(audit, "attempt", "finished"); }
  });
}

export async function auditProvisioningStage(stage: Stage, event: "started" | "completed" | "failed" | "skipped") {
  const audit = storage.getStore();
  if (audit) await emit(audit, stage, event);
}

/** Counts application invocations, not provider billing or physical network delivery. */
export async function auditedProvisioningCall<T>(
  kind: Call, work: () => Promise<T>, selection?: ModelSelection,
): Promise<T> {
  const audit = storage.getStore();
  if (!audit) return work();
  if (audit.calls[kind] >= 1) {
    await emit(audit, kind, "call_blocked", selection);
    throw new Error("PROVISIONING_CALL_LIMIT_EXCEEDED");
  }
  await emit(audit, kind, "call_reserved", selection, { critical: true });
  await emit(audit, kind, "call_started", selection, { critical: true });
  try {
    const result = await work();
    // Returned means an invocation resolved, not that the provider accepted creation.
    await emit(audit, kind, "call_returned", selection);
    return result;
  } catch (error) {
    if (!(error instanceof ProvisioningAuditUnavailableError)) {
      await emit(audit, kind, "call_result_unknown", selection);
    }
    throw error;
  }
}

export async function recoverInterruptedProvisioningAttempt(
  tx: Pick<typeof db, "select" | "update">, assetId: string,
): Promise<void> {
  const [attempt] = await tx.select().from(provisioningAttempts).where(and(
    eq(provisioningAttempts.assetId, assetId), eq(provisioningAttempts.state, "active"),
  )).orderBy(desc(provisioningAttempts.createdAt)).limit(1).for("update");
  if (!attempt) return;
  await tx.update(provisioningAttempts).set({
    state: "result_unknown", event: "recovered_unknown", sequence: attempt.sequence + 1,
    geminiCallState: attempt.geminiCallState === "started" || attempt.geminiCallState === "returned" ? "result_unknown" : attempt.geminiCallState,
    providerCreateCallState: attempt.providerCreateCallState === "started" || attempt.providerCreateCallState === "returned" ? "result_unknown" : attempt.providerCreateCallState,
    updatedAt: new Date(),
  }).where(eq(provisioningAttempts.attemptId, attempt.attemptId));
}
