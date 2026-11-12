import { db, avatarSessions, liveBudgetSettings, eq, and, sql } from "@workspace/db";
import { dailyLimits } from "./stock-policy";

export const projectBudgetScope = (tenant: string) => `project:${tenant}`;

export async function budgetSnapshot(tenant: string, reader: Pick<typeof db, "select"> = db) {
  const defaults = dailyLimits();
  const rows = await reader.select().from(liveBudgetSettings).where(
    sql`${liveBudgetSettings.scope} in ('service', ${projectBudgetScope(tenant)})`,
  );
  const project = rows.find(r => r.scope === projectBudgetScope(tenant));
  const service = rows.find(r => r.scope === "service");
  const [usage] = await reader.select({
    user: sql<number>`coalesce(sum(${avatarSessions.reservedSeconds}) filter (
      where ${avatarSessions.tenantId} = ${tenant}
      and ${avatarSessions.startedAt} >= ${project?.resetAt ?? new Date(0)}), 0)::int`,
    global: sql<number>`coalesce(sum(${avatarSessions.reservedSeconds}) filter (
      where ${avatarSessions.startedAt} >= ${service?.resetAt ?? new Date(0)}), 0)::int`,
  }).from(avatarSessions).where(and(eq(avatarSessions.mode, "live"),
    sql`${avatarSessions.startedAt} >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`));
  return { usage: usage!, project, service, limits: {
    user: project?.dailySeconds ?? defaults.user,
    global: service?.dailySeconds ?? defaults.global,
  } };
}
