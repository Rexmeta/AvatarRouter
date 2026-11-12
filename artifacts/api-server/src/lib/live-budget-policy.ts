import { db, avatarSessions, liveBudgetSettings, eq, and, sql } from "@workspace/db";
import { dailyLimits } from "./stock-policy";
import { liveCapacityFence } from "./live-admission";

export const projectBudgetScope = (tenant: string) => `project:${tenant}`;

export async function budgetSnapshot(tenant: string, reader: Pick<typeof db, "select"> = db) {
  const defaults = dailyLimits();
  const rows = await reader.select().from(liveBudgetSettings).where(
    sql`${liveBudgetSettings.scope} in ('service', ${projectBudgetScope(tenant)})`,
  );
  const project = rows.find(r => r.scope === projectBudgetScope(tenant));
  const service = rows.find(r => r.scope === "service");
  // Measure router session elapsed time, not the maximum admitted duration. Stop/expiry
  // bounds exclude delayed cleanup. This is not provider billing or voiced-speech time.
  const elapsed = sql`case when ${avatarSessions.providerCreateState} in ('not_started', 'rejected')
      and ${avatarSessions.providerConversationId} is null then 0
    else least(greatest(0, ${avatarSessions.reservedSeconds}),
      greatest(0, floor(extract(epoch from (
        least(now(), ${avatarSessions.expiresAt}, ${avatarSessions.endedAt}, ${avatarSessions.stopRequestedAt})
        - ${avatarSessions.startedAt}
      ))))) end`;
  // An unresolved remote session still holds the unspent reservation. Merely requesting
  // /end or changing status must never release capacity/budget before cleanup is known.
  const held = sql`case when ${liveCapacityFence()} then
    greatest(0, ${avatarSessions.reservedSeconds} - (${elapsed})) else 0 end`;
  const projectFilter = sql`${avatarSessions.tenantId} = ${tenant}
    and ${avatarSessions.startedAt} >= ${project?.resetAt ?? new Date(0)}`;
  const serviceFilter = sql`${avatarSessions.startedAt} >= ${service?.resetAt ?? new Date(0)}`;
  const [usage] = await reader.select({
    actualUser: sql<number>`coalesce(sum(${elapsed}) filter (where ${projectFilter}), 0)::int`,
    actualGlobal: sql<number>`coalesce(sum(${elapsed}) filter (where ${serviceFilter}), 0)::int`,
    reservedUser: sql<number>`coalesce(sum(${held}) filter (where ${projectFilter}), 0)::int`,
    reservedGlobal: sql<number>`coalesce(sum(${held}) filter (where ${serviceFilter}), 0)::int`,
  }).from(avatarSessions).where(and(eq(avatarSessions.mode, "live"),
    sql`${avatarSessions.startedAt} >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`));
  return { usage: { ...usage!, user: usage!.actualUser + usage!.reservedUser,
    global: usage!.actualGlobal + usage!.reservedGlobal }, project, service, limits: {
    user: project?.dailySeconds ?? defaults.user,
    global: service?.dailySeconds ?? defaults.global,
  } };
}
