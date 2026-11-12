import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { decodeProviderFailure, providerFailureStorageCode } from "./provider-session-failure";

export type RendererStage =
  | "runtime_start" | "room_create" | "rtc_connect" | "provider_dispatch"
  | "provider_create" | "provider_id_persist" | "video_join" | "running_persist"
  | "cleanup" | "runtime_stop" | "remote_cleanup" | "cleanup_persist"
  | "provider_end" | "room_cleanup" | "agent_close" | "avatar_close" | "rtc_disconnect";
type Outcome = "begin" | "success" | "failure";
type Sink = (failed: boolean, fields: Record<string, unknown>) => void;

// Only exact known values and numeric statuses may cross this boundary. Never
// serialize arbitrary errors, messages, stacks, URLs, SDK bodies or causes.
export function safeRendererError(error: unknown): {
  errorClass: string; httpStatus?: number; transportCode?: string;
  providerHttpStatus?: number; providerErrorCode?: string;
} {
  const read = (value: unknown, key: string): unknown => {
    try { return value && (typeof value === "object" || typeof value === "function") ? Reflect.get(value, key) : undefined; }
    catch { return undefined; }
  };
  const classes = ["APIStatusError", "APIConnectionError", "APITimeoutError",
    "TimeoutError", "AbortError", "TavusException", "SessionProblem",
    "ConnectionError", "Error", "TypeError"];
  const codes = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND",
    "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
    "LIVE_LEASE_LOST", "23505", "40001", "40P01", "53300", "57P01"];
  const name = read(error, "name");
  const constructorName = read(read(error, "constructor"), "name");
  const status = read(error, "statusCode") ?? read(error, "status");
  const cause = read(error, "cause");
  const code = read(error, "code") ?? read(cause, "code");
  const provider = decodeProviderFailure(providerFailureStorageCode(error));
  return {
    errorClass: typeof constructorName === "string" && classes.includes(constructorName) ? constructorName
      : typeof name === "string" && classes.includes(name) ? name : "UnknownError",
    ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? { httpStatus: status } : {}),
    ...(typeof code === "string" && codes.includes(code) ? { transportCode: code } : {}),
    ...(provider?.providerHttpStatus ? { providerHttpStatus: provider.providerHttpStatus } : {}),
    ...(provider?.providerErrorCode ? { providerErrorCode: provider.providerErrorCode } : {}),
  };
}

export class RendererDiagnostics {
  private readonly started = performance.now();
  private readonly attemptId = randomUUID();
  private sequence = 0;
  private readonly active = new Map<RendererStage, number>();
  constructor(
    private readonly context: { sessionId: string; workerId: string; target: "stock" | "custom" },
    private readonly sink: Sink = (failed, fields) => {
      if (failed) logger.error(fields, "Renderer diagnostic");
      else logger.info(fields, "Renderer diagnostic");
    },
  ) {}

  private emit(fields: Record<string, unknown>, failed = false) {
    // Diagnostics must never prevent creation-ID persistence or cleanup.
    try {
      this.sink(failed, {
        diagnosticVersion: 1, ...this.context,
        attemptId: this.attemptId, sequence: ++this.sequence,
        elapsedMs: Math.round(performance.now() - this.started), ...fields,
      });
    } catch { /* logging is best-effort, lifecycle safety is not */ }
  }

  async stage<T>(stage: RendererStage, work: () => Promise<T>): Promise<T> {
    this.active.set(stage, (this.active.get(stage) ?? 0) + 1);
    const start = performance.now();
    const stageRunId = randomUUID();
    const record = (outcome: Outcome, error?: unknown) => this.emit({
      stage, stageRunId, outcome, durationMs: Math.round(performance.now() - start),
      ...(outcome === "failure" ? safeRendererError(error) : {}),
    }, outcome === "failure");
    record("begin");
    try {
      const result = await work();
      record("success");
      return result;
    } catch (error) {
      record("failure", error);
      throw error;
    } finally {
      const count = this.active.get(stage)! - 1;
      if (count) this.active.set(stage, count);
      else this.active.delete(stage);
    }
  }

  leaseLost(reason: "deadline" | "ownership" | "watchdog" | "operation_failure") {
    this.emit({ event: "lease_lost", reason, activeStages: [...this.active.keys()] }, true);
  }

  failure(event: "initialize_failed" | "operation_failed" | "lease_cleanup_failed", error: unknown) {
    this.emit({ event, activeStages: [...this.active.keys()], ...safeRendererError(error) }, true);
  }

  claimed(creationAllowed: boolean, queueWaitMs: number, ttlRemainingMs: number, leaseMs: number) {
    this.emit({ event: "session_claimed", creationAllowed, queueWaitMs, ttlRemainingMs, leaseMs });
  }

  cleanupResult(providerEnded: boolean, roomDeleted: boolean, creationUnknown: boolean) {
    this.emit({ event: "cleanup_result", providerEnded, roomDeleted, creationUnknown });
  }
}
