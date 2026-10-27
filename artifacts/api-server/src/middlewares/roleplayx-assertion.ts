import type { RequestHandler } from "express";
import { SessionProblem } from "../lib/session-service";
import { peekRoleplayxIssuer, readRoleplayxAuthConfig, verifyRoleplayxTokenFromJwks } from "../lib/roleplayx-auth";

function readBearer(header?: string): string | null {
  const match = /^\s*Bearer\s+([^\s]+)\s*$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

/** Validate a pinned RoleplayX access-token issuer before it can bypass Clerk middleware. */
export const roleplayxAssertion: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith("/api/v1/")) { next(); return; }
  const token = readBearer(req.get("authorization"));
  const expectedIssuer = process.env.ROLEPLAYX_ISSUER?.trim();
  if (!token || !expectedIssuer || peekRoleplayxIssuer(token) !== expectedIssuer) {
    next();
    return;
  }

  void (async () => {
    const config = readRoleplayxAuthConfig();
    if (!config) throw new SessionProblem(503, "ROLEPLAYX_BRIDGE_MISCONFIGURED", "The RoleplayX identity bridge is not configured.");
    const identity = await verifyRoleplayxTokenFromJwks(token, config);
    res.locals.roleplayxIdentity = identity;
    res.set("Cache-Control", "private, no-store");
    next();
  })().catch(next);
};
