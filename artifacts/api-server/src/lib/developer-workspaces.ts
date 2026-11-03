import { db, avatarSessions, avatarSessionEvents, and, eq, desc } from "@workspace/db";
import { developerOwnerHash, hashServiceValue, listDeveloperKeys } from "./service-api-keys";
import { presentSession, SessionProblem } from "./session-service";
import { liveLimits } from "./live-sessions";

export function ownedProject<T extends { projectId: string; projectName: string }>(keys: T[], projectId: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(projectId)) {
    throw new SessionProblem(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  }
  const projectKeys = keys.filter(key => key.projectId === projectId);
  if (!projectKeys.length) throw new SessionProblem(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  return { projectId, projectName: projectKeys[0]!.projectName, keys: projectKeys };
}

export const projectTenant = (projectId: string) => hashServiceValue(`avatarrouter:project:${projectId}`);

export async function requireOwnedProject(userId: string, projectId: string) {
  return ownedProject(await listDeveloperKeys(developerOwnerHash(userId)), projectId);
}

export async function developerWorkspace(owner: string, projectId: string) {
  const project = ownedProject(await listDeveloperKeys(owner), projectId);
  const tenant = projectTenant(projectId);
  const [sessions, limits] = await Promise.all([
    db.select().from(avatarSessions).where(eq(avatarSessions.tenantId, tenant)).orderBy(desc(avatarSessions.startedAt)).limit(200),
    liveLimits(tenant),
  ]);
  // No operator-only provider references, reconciliation diagnostics or audit data.
  return { ...project, sessions: sessions.map(presentSession), limits };
}

export async function developerWorkspaceEvents(owner: string, projectId: string, id: string) {
  ownedProject(await listDeveloperKeys(owner), projectId);
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Session not found.");
  const [session] = await db.select({id:avatarSessions.id}).from(avatarSessions)
    .where(and(eq(avatarSessions.id,id),eq(avatarSessions.tenantId,projectTenant(projectId))));
  if (!session) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Session not found.");
  return (await db.select().from(avatarSessionEvents).where(eq(avatarSessionEvents.sessionId,id))
    .orderBy(desc(avatarSessionEvents.createdAt)).limit(100))
    .map(({id:eventId,type,message,createdAt})=>({id:eventId,type,message,createdAt:createdAt.toISOString()}));
}
