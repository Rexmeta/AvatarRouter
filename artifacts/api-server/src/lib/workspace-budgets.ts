import { randomUUID } from "node:crypto";
import { db, avatarSessions, liveBudgetSettings, liveBudgetAudit, and, eq, sql } from "@workspace/db";
import { budgetSnapshot, projectBudgetScope } from "./live-budget-policy";
import { ownedProject, projectTenant } from "./developer-workspaces";
import { listDeveloperKeys } from "./service-api-keys";
import { liveSessionMs } from "./stock-policy";
import { liveCapacityFence } from "./live-admission";
import { SessionProblem } from "./session-service";

export async function workspaceBudget(owner: string, projectId: string, operator: boolean) {
  ownedProject(await listDeveloperKeys(owner), projectId);
  const b = await budgetSnapshot(projectTenant(projectId));
  const scope = (dailySeconds: number, usedSeconds: number, reservedSeconds: number, row: typeof b.project) => ({
    dailySeconds, usedSeconds, reservedSeconds, remainingSeconds: Math.max(0, dailySeconds - usedSeconds - reservedSeconds),
    revision: row?.revision ?? 0, resetAt: row?.resetAt?.toISOString() ?? null,
  });
  return {
    project: scope(b.limits.user, b.usage.actualUser, b.usage.reservedUser, b.project),
    service: scope(b.limits.global, b.usage.actualGlobal, b.usage.reservedGlobal, b.service),
    canManageService: operator, sessionSeconds: liveSessionMs() / 1000,
    resetsAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString(),
  };
}

export async function mutateWorkspaceBudget(owner: string, projectId: string,
  input: { scope: "project" | "service"; revision: number; dailySeconds?: number }, operator: boolean, reset: boolean) {
  ownedProject(await listDeveloperKeys(owner), projectId);
  if (input.scope === "service" && !operator) throw new SessionProblem(403, "TRUSTED_OPERATOR_REQUIRED", "Only a trusted operator can change the service-wide budget.");
  const tenant = projectTenant(projectId);
  const scope = input.scope === "service" ? "service" : projectBudgetScope(tenant);
  await db.transaction(async tx => {
    // Same cross-process lock as admission: reset/save cannot race a new reservation.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('avatar-router:stock-live'))`);
    const snapshot = await budgetSnapshot(tenant, tx);
    const current = input.scope === "service" ? snapshot.service : snapshot.project;
    if ((current?.revision ?? 0) !== input.revision) throw new SessionProblem(409, "BUDGET_REVISION_CHANGED", "Budget changed in another tab. Refresh and confirm again.");
    const before = {
      dailySeconds: input.scope === "service" ? snapshot.limits.global : snapshot.limits.user,
      resetAt: current?.resetAt?.toISOString() ?? null,
    };
    if (!reset && input.scope === "project" && input.dailySeconds! > snapshot.limits.global) {
      throw new SessionProblem(409, "PROJECT_BUDGET_EXCEEDS_SERVICE", "The project budget cannot exceed the service daily budget. Only an operator can raise that ceiling.");
    }
    if (reset) {
      const [blocked] = await tx.select({ id: avatarSessions.id }).from(avatarSessions).where(and(
        liveCapacityFence(), input.scope === "project" ? eq(avatarSessions.tenantId, tenant) : sql`true`,
      )).limit(1);
      if (blocked) throw new SessionProblem(409, "BUDGET_RESET_SESSION_UNRESOLVED", "End and verify active/unresolved sessions before resetting. Reset never clears provider cleanup or uncertain creation.");
    }
    const clock = await tx.execute<{ at: Date }>(sql`select clock_timestamp() as at`);
    const resetAt = reset ? new Date(clock.rows[0]!.at) : current?.resetAt ?? null;
    const dailySeconds = reset ? before.dailySeconds : input.dailySeconds!;
    await tx.insert(liveBudgetSettings).values({ scope, dailySeconds, resetAt, revision: input.revision + 1 }).onConflictDoUpdate({
      target: liveBudgetSettings.scope,
      set: { dailySeconds, resetAt, revision: input.revision + 1, updatedAt: new Date() },
    });
    await tx.insert(liveBudgetAudit).values({
      id: randomUUID(), scope, actor: owner, action: reset ? "reset" : "update", before,
      after: { dailySeconds, resetAt: resetAt?.toISOString() ?? null },
    });
  });
  return workspaceBudget(owner, projectId, operator);
}
