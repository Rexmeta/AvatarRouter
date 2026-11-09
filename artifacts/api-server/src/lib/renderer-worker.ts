import { randomUUID } from "node:crypto";
import { db, avatarSessions, avatarSessionEvents, rendererCommands, rendererWorkers, and, eq, sql, type AvatarSessionRecord } from "@workspace/db";
import { StockRuntime, terminateResources, runtimeFace } from "./stock-runtime";
import { HEARTBEAT_MS, LEASE_MS, safeLiveError } from "./stock-policy";
import { SessionProblem } from "./session-service";
import { readRendererAudio, removeRendererAudio } from "./private-images";
import { logger } from "./logger";
import { RendererDiagnostics, safeRendererError } from "./renderer-diagnostics";
import { storeRendererDiagnostic, pruneRendererDiagnostics } from "./renderer-diagnostic-store";
import { TavusFullRuntime, terminateFullResources } from "./tavus-full-runtime";
import { AnamRuntime, terminateAnamResources } from "./anam-runtime";

type Runtime = Pick<StockRuntime, "start" | "stop" | "sendAudio" | "interrupt"> & { connected?: () => boolean };
type Factory = (row: AvatarSessionRecord, onId: (id: string) => Promise<void>, beforeCreate: () => Promise<void>, rejected: () => Promise<void>, diagnostics: RendererDiagnostics) => Runtime;
type Local = { runtime?: Runtime; closing: boolean; deadline: number; audioBusy: boolean; starting: boolean; task?: Promise<void>; diagnostics: RendererDiagnostics };

/** RTC is owned exclusively here, never by an HTTP process. DB leases fence every state transition. */
export class RendererWorker {
  readonly id = randomUUID();
  private locals = new Map<string, Local>();
  private stopping = false;
  private ticking = false;
  private timer?: NodeJS.Timeout;
  private healthyAt = 0;
  get healthy() { return !this.stopping && Date.now() - this.healthyAt < 10_000; }

  constructor(
    private factory: Factory = (row, onId, before, rejected, diagnostics) => {
      if (row.pipeline === "anam_full") return new AnamRuntime(row, before, rejected, async options => {
        const [saved] = await db.update(avatarSessions).set({
          fullPipeline: options, providerCreateState: "token_issued",
        }).where(and(this.owns(row.id), sql`${avatarSessions.stopRequestedAt} is null`)).returning();
        if (!saved) throw new SessionProblem(409, "LIVE_LEASE_LOST", "Lease lost before native token persistence.");
      });
      if (row.pipeline === "tavus_full") return new TavusFullRuntime(row, onId, before, rejected, async options => {
        await db.update(avatarSessions).set({ fullPipeline: options }).where(eq(avatarSessions.id, row.id));
      });
      const runtime = new StockRuntime(row.roomName!, onId, before, rejected, terminateResources, runtimeFace(row), diagnostics);
      return Object.assign(runtime, { connected: () => runtime.room.isConnected });
    },
    private terminate = terminateResources,
  ) {}

  private owns(id: string) {
    return and(eq(avatarSessions.id, id), eq(avatarSessions.workerId, this.id), sql`${avatarSessions.leaseExpiresAt} > now()`);
  }

  async start() {
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, HEARTBEAT_MS);
  }

  async tick() {
    if (this.ticking || this.stopping) return;
    pruneRendererDiagnostics();
    this.ticking = true;
    try {
      await db.insert(rendererWorkers).values({ id: this.id }).onConflictDoUpdate({
        target: rendererWorkers.id, set: { heartbeatAt: sql`now()` },
      });
      this.healthyAt = Date.now();
      for (const [id, local] of this.locals) {
        if (Date.now() >= local.deadline) { this.loseLease(id, local, "deadline"); continue; }
        const [row] = await db.update(avatarSessions).set({
          heartbeatAt: sql`now()`, leaseExpiresAt: sql`now() + interval '20 seconds'`,
        }).where(this.owns(id)).returning();
        if (!row) { this.loseLease(id, local, "ownership"); continue; }
        local.deadline = Date.now() + LEASE_MS - HEARTBEAT_MS;
        if (local.closing) continue;
        const disconnected = !local.starting && !!local.runtime?.connected && !local.runtime.connected();
        if (row.stopRequestedAt || row.expiresAt.getTime() <= Date.now() || disconnected) {
          if (disconnected && !row.stopRequestedAt && row.expiresAt.getTime() > Date.now()) {
            const [failed] = await db.update(avatarSessions).set({
              stopRequestedAt: sql`now()`, stopStatus: "failed", stopError: "LIVE_RTC_DISCONNECTED",
            }).where(and(this.owns(id), sql`${avatarSessions.stopRequestedAt} is null`)).returning();
            if (failed) {
              Object.assign(row, failed);
              await this.event(id, "rtc_disconnected", "Renderer RTC disconnected before the session deadline. Cleanup requested; playback was not verified.");
            }
          }
          local.closing = true;
          local.task = this.finish(row, local).catch(error => this.cleanupFailed(id, local, error));
        } else if (!local.starting) {
          await this.dispatchCommands(row, local);
        }
      }
      // Atomic SKIP LOCKED claim works with multiple workers and multiple API replicas.
      const claimed = await db.transaction(async tx => {
        const [row] = await tx.select().from(avatarSessions).where(and(
          eq(avatarSessions.mode, "live"),
          sql`(${avatarSessions.status} = 'active' or ${avatarSessions.roomName} is not null or ${avatarSessions.providerConversationId} is not null
            or ${avatarSessions.rendererState} in ('cleanup_pending', 'maintenance_pending', 'stopping'))`,
          sql`(${avatarSessions.leaseExpiresAt} is null or ${avatarSessions.leaseExpiresAt} <= now())`,
          sql`(${avatarSessions.cleanupRetryAt} is null or ${avatarSessions.cleanupRetryAt} <= now())`,
        )).orderBy(avatarSessions.startedAt).limit(1).for("update", { skipLocked: true });
        if (!row) return;
        const canStart = row.rendererState === "queued" && row.status === "active" &&
          !row.workerId && !row.stopRequestedAt && row.providerCreateState === "not_started" &&
          row.expiresAt.getTime() > Date.now() && !row.providerConversationId &&
          row.error !== "LIVE_CREATE_RECONCILIATION_REQUIRED";
        const [updated] = await tx.update(avatarSessions).set({
          workerId: this.id, heartbeatAt: sql`now()`, leaseExpiresAt: sql`now() + interval '20 seconds'`,
          rendererState: canStart ? "starting" : row.rendererState === "maintenance_pending" ? "maintenance_pending" : "stopping",
        }).where(eq(avatarSessions.id, row.id)).returning();
        return { row: updated!, canStart };
      });
      if (claimed) {
        const local: Local = {
          closing: !claimed.canStart, starting: claimed.canStart,
          deadline: Date.now() + LEASE_MS - HEARTBEAT_MS, audioBusy: false,
          diagnostics: new RendererDiagnostics({
            sessionId: claimed.row.id, workerId: this.id,
            target: claimed.row.avatarAssetId ? "custom" : "stock",
          }, storeRendererDiagnostic),
        };
        local.diagnostics.claimed(claimed.canStart,
          Math.max(0, Date.now() - claimed.row.startedAt.getTime()),
          claimed.row.expiresAt.getTime() - Date.now(), LEASE_MS);
        this.locals.set(claimed.row.id, local);
        local.task = (claimed.canStart ? this.initialize(claimed.row, local) : this.finish(claimed.row, local))
          .catch(error => this.cleanupFailed(claimed.row.id, local, error));
      }
      await this.gcCommands();
    } catch (error) {
      logger.error({ workerId: this.id, ...safeRendererError(error) }, "Renderer tick failed; local lease watchdog will stop RTC");
    } finally { this.ticking = false; }
    // A DB outage cannot keep rendering indefinitely while heartbeat is blocked.
  }

  private loseLease(id: string, local: Local, reason: "deadline" | "ownership" | "watchdog" | "operation_failure" = "ownership") {
    local.diagnostics.leaseLost(reason);
    this.locals.delete(id);
    local.closing = true;
    void local.runtime?.stop().catch(error => local.diagnostics.failure("lease_cleanup_failed", error));
  }

  private async initialize(row: AvatarSessionRecord, local: Local) {
    const runtime = this.factory(row, async conversationId => {
      // A late ID must survive lease loss. IDs are never discarded even if stop was already requested.
      await db.update(avatarSessions).set({
        providerConversationId: conversationId, providerCreateState: "known",
        rendererState: sql`case when ${avatarSessions.workerId} = ${this.id} then ${avatarSessions.rendererState} else 'cleanup_pending' end`,
        cleanupRetryAt: null,
      }).where(eq(avatarSessions.id, row.id));
    }, async () => {
      const [marked] = await db.update(avatarSessions).set({ providerCreateState: "submitted" }).where(and(
        this.owns(row.id), eq(avatarSessions.providerCreateState, "not_started"),
        sql`${avatarSessions.stopRequestedAt} is null and ${avatarSessions.expiresAt} > now()`,
      )).returning();
      if (!marked || local.closing || Date.now() >= local.deadline) throw new SessionProblem(409, "LIVE_LEASE_LOST", "Renderer lease lost before provider creation.");
    }, async () => {
      await db.update(avatarSessions).set({ providerCreateState: "rejected" }).where(this.owns(row.id));
    }, local.diagnostics);
    local.runtime = runtime;
    // Independent local watchdog remains effective when PostgreSQL/network calls stall.
    const watchdog = setInterval(() => {
      if (Date.now() >= local.deadline || Date.now() >= row.expiresAt.getTime()) {
        clearInterval(watchdog);
        this.loseLease(row.id, local, "watchdog");
      }
    }, 500);
    watchdog.unref();
    try {
      await local.diagnostics.stage("runtime_start", () => runtime.start());
      local.starting = false;
      const [running] = await local.diagnostics.stage("running_persist", () => db.update(avatarSessions).set({ rendererState: "running" }).where(and(
        this.owns(row.id), sql`${avatarSessions.stopRequestedAt} is null and ${avatarSessions.expiresAt} > now()`,
      )).returning());
      if (!running || local.closing) {
        local.closing = true;
        await this.finish(row, local);
      } else {
        await this.event(row.id, "started", row.pipeline === "anam_full"
          ? "Anam single-start token ready for authorized SDK handoff. No browser connection, speech or video playback has been verified."
          : row.pipeline === "tavus_full"
          ? "Private Tavus full-pipeline connection ready. Tavus owns dialogue, voice and rendering; Daily client playback is not yet verified."
          : "Renderer worker connected the selected real avatar. Playback validation is separate; no AI dialogue or custom training.");
      }
    } catch (error) {
      local.diagnostics.failure("initialize_failed", error);
      local.starting = false;
      local.closing = true;
      const problem = error instanceof SessionProblem ? error : safeLiveError(error);
      await db.update(avatarSessions).set({ stopStatus: "failed", stopError: problem.code, stopRequestedAt: sql`now()` })
        .where(and(this.owns(row.id), sql`${avatarSessions.stopRequestedAt} is null`));
      await this.finish(row, local);
    } finally {
      // While running, keep the watchdog until the runtime is closed/removed.
      if (local.closing || !this.locals.has(row.id)) clearInterval(watchdog);
      else {
        const task = local;
        const monitor = setInterval(() => {
          if (task.closing || !this.locals.has(row.id)) { clearInterval(watchdog); clearInterval(monitor); }
        }, 500);
        monitor.unref();
      }
    }
  }

  private async finish(initial: AvatarSessionRecord, local: Local) {
    return local.diagnostics.stage("cleanup", () => this.finishResources(initial, local));
  }

  private async finishResources(initial: AvatarSessionRecord, local: Local) {
    // Non-billable persona maintenance must not re-enter the paid-session fence.
    await db.update(avatarSessions).set({
      rendererState: initial.rendererState === "maintenance_pending" ? "maintenance_pending" : "stopping",
    }).where(this.owns(initial.id));
    // stop waits for an in-flight paid POST so late conversation IDs can be persisted.
    const runtimeResult = local.runtime ? await local.diagnostics.stage("runtime_stop", () => local.runtime!.stop()) : undefined;
    const [row] = await db.select().from(avatarSessions).where(this.owns(initial.id));
    if (!row) { this.locals.delete(initial.id); return; }
    const result = row.pipeline === "anam_full"
      ? await local.diagnostics.stage("remote_cleanup", () => terminateAnamResources(row.id, row.fullPipeline))
      : runtimeResult ?? await local.diagnostics.stage("remote_cleanup", () => row.pipeline === "tavus_full"
      ? terminateFullResources(row.providerConversationId, row.fullPipeline?.palId)
      : this.terminate(row.roomName, row.providerConversationId, local.diagnostics));
    const unknown = row.pipeline !== "anam_full" && ((!row.providerConversationId && ["submitted", "unknown"].includes(row.providerCreateState)) ||
      (!row.providerConversationId && row.error === "LIVE_CREATE_RECONCILIATION_REQUIRED") ||
      (!result.providerEnded && !row.providerConversationId));
    const callClosed = !unknown && result.providerEnded && result.roomDeleted;
    const maintenancePending = row.pipeline === "tavus_full" && callClosed &&
      "palDeleted" in result && result.palDeleted !== true;
    const confirmed = callClosed && !maintenancePending;
    local.diagnostics.cleanupResult(result.providerEnded, result.roomDeleted, unknown);
    if ("palDeleted" in result) logger.info({
      sessionId: row.id, providerEnded: result.providerEnded, roomDeleted: result.roomDeleted,
      palDeleted: result.palDeleted, maintenancePending,
    }, "Tavus full cleanup resource results");
    const status = row.stopStatus ?? (row.expiresAt.getTime() <= Date.now() ? "expired" : "failed");
    const attempts = row.cleanupAttempts + 1;
    const [updated] = await local.diagnostics.stage("cleanup_persist", () => db.update(avatarSessions).set({
      status: row.status === "active" ? status : row.status, endedAt: row.endedAt ?? new Date(),
      rendererState: unknown ? "reconciliation_required" : maintenancePending ? "maintenance_pending" : confirmed ? "closed" : "cleanup_pending",
      providerCreateState: row.pipeline === "anam_full" && callClosed ? "known" : unknown ? "unknown" : row.providerCreateState,
      error: unknown ? "LIVE_CREATE_RECONCILIATION_REQUIRED" : maintenancePending ? "LIVE_PAL_CLEANUP_PENDING" : confirmed ? row.stopError : "LIVE_CLEANUP_PENDING",
      roomName: result.roomDeleted ? null : row.roomName,
      providerConversationId: result.providerEnded && !unknown ? null : row.providerConversationId,
      ...(["tavus_full", "anam_full"].includes(row.pipeline) && callClosed ? {
        fullPipeline: maintenancePending ? { systemPrompt: "", palId: row.fullPipeline?.palId } : null,
      } : {}),
      cleanupAttempts: attempts, cleanupRetryAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6))),
      workerId: null, leaseExpiresAt: null,
    }).where(and(this.owns(row.id), sql`${avatarSessions.providerConversationId} is not distinct from ${row.providerConversationId}`)).returning());
    this.locals.delete(row.id);
    if (!updated) return; // a late ID changed the cleanup snapshot; another sweep will clean it.
    if (!callClosed) logger.warn({ sessionId: row.id, attempts, reconciliationRequired: unknown }, "Paid session cleanup unconfirmed; billing may continue");
    else if (maintenancePending) logger.warn({ sessionId: row.id, attempts }, "Call ended; temporary PAL deletion pending, not a paid-start blocker");
    await this.event(row.id, maintenancePending ? "maintenance_pending" : confirmed ? status : "cleanup_pending", maintenancePending
      ? "Provider call termination and room cleanup confirmed. Temporary PAL deletion will retry separately; this does not block new paid calls."
      : confirmed
      ? "Provider termination and LiveKit room absence confirmed."
      : unknown ? "Paid creation outcome unknown. Automatic creation retries blocked; operator reconciliation required."
        : "Remote cleanup unconfirmed. Provider termination and room deletion will retry; billing may continue.");
  }

  private cleanupFailed(id: string, local: Local, error: unknown) {
    local.diagnostics.failure("operation_failed", error);
    // Retain lease/references for another worker to recover after lease expiry.
    this.loseLease(id, local, "operation_failure");
    logger.error({ sessionId: id }, "Renderer operation failed; durable cleanup will retry");
  }

  private async dispatchCommands(row: AvatarSessionRecord, local: Local) {
    const commands = await db.select().from(rendererCommands).where(and(
      eq(rendererCommands.sessionId, row.id), eq(rendererCommands.state, "queued"),
      sql`${rendererCommands.expiresAt} > now()`,
    )).orderBy(rendererCommands.createdAt).limit(4);
    for (const cmd of commands) {
      if (cmd.type === "audio" && local.audioBusy) continue;
      const [claimed] = await db.update(rendererCommands).set({ state: "processing" }).where(and(
        eq(rendererCommands.id, cmd.id), eq(rendererCommands.state, "queued"),
        sql`exists (select 1 from ${avatarSessions} where ${avatarSessions.id} = ${row.id} and ${avatarSessions.workerId} = ${this.id} and ${avatarSessions.leaseExpiresAt} > now() and ${avatarSessions.stopRequestedAt} is null)`,
      )).returning();
      if (!claimed) continue;
      if (cmd.type === "audio") local.audioBusy = true;
      void (async () => {
        try {
          if (cmd.type === "audio") {
            const bytes = await readRendererAudio(cmd.objectPath!);
            if (local.closing || Date.now() >= local.deadline) throw new Error("Renderer stopped");
            await local.runtime!.sendAudio(bytes);
          } else {
            await local.runtime!.interrupt();
            await db.update(avatarSessions).set({ interruptions: sql`${avatarSessions.interruptions} + 1` }).where(this.owns(row.id));
            await this.event(row.id, "interrupted", "Renderer audio buffer cleared.");
          }
          await db.update(rendererCommands).set({ state: "done" }).where(eq(rendererCommands.id, cmd.id));
        } catch {
          await db.update(rendererCommands).set({ state: "failed", error: "LIVE_COMMAND_FAILED" }).where(eq(rendererCommands.id, cmd.id));
        } finally { if (cmd.type === "audio") local.audioBusy = false; }
      })().catch(() => logger.warn({ sessionId: row.id }, "Renderer command outcome unknown; command will not replay"));
    }
  }

  private async gcCommands() {
    const rows = await db.select().from(rendererCommands).where(sql`${rendererCommands.expiresAt} < now() - interval '1 minute'`).limit(30);
    for (const cmd of rows) {
      try {
        if (cmd.objectPath) await removeRendererAudio(cmd.objectPath);
        await db.delete(rendererCommands).where(eq(rendererCommands.id, cmd.id));
      } catch { logger.warn({ commandId: cmd.id }, "Temporary PCM cleanup will retry"); }
    }
    await db.delete(rendererWorkers).where(sql`${rendererWorkers.heartbeatAt} < now() - interval '1 day'`);
  }

  private event(sessionId: string, type: string, message: string) {
    return db.insert(avatarSessionEvents).values({ id: randomUUID(), sessionId, type, message });
  }

  async shutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    await db.delete(rendererWorkers).where(eq(rendererWorkers.id, this.id));
    await Promise.allSettled([...this.locals].map(async ([id, local]) => {
      const [row] = await db.select().from(avatarSessions).where(this.owns(id));
      if (!row) return this.loseLease(id, local);
      local.closing = true;
      await this.finish(row, local);
    }));
  }
}
