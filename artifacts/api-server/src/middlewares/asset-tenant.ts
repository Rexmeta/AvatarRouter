import { createHash } from "node:crypto";
import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { SessionProblem } from "../lib/session-service";
import { integrationIdentity } from "../lib/integration-identity";
import { assertSameOriginForBridgeRequest, requiredRoleplayxScope } from "./session-owner";
import { projectTenant, requireOwnedProject } from "../lib/developer-workspaces";

// Personal, isolated tenants for now. No client-supplied tenant identifiers.
export const assetTenant: RequestHandler = async (req, res, next) => {
  const requestedProject = req.get("x-avatar-workspace-id") ?? req.query.workspaceId;
  const roleplayxIdentity = integrationIdentity(res);
  if (roleplayxIdentity) {
    if (requestedProject !== undefined) throw new SessionProblem(403, "WORKSPACE_CONTEXT_REJECTED", "Integration credentials cannot select another workspace.");
    assertSameOriginForBridgeRequest(req);
    if (req.get("sec-fetch-site") === "cross-site") {
      throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-site requests are not allowed.");
    }
    const requiredScope = requiredRoleplayxScope(req.method, req.originalUrl.split("?")[0] ?? "");
    if (!requiredScope || !roleplayxIdentity.scopes.includes(requiredScope)) {
      throw new SessionProblem(403, roleplayxIdentity.provider === "api-key" ? "INSUFFICIENT_API_KEY_SCOPE" : "INSUFFICIENT_ROLEPLAYX_SCOPE", "The authenticated integration does not have permission for this operation.");
    }
    const context = roleplayxIdentity;
    res.locals.tenantId = context.tenantId;
    res.locals.ownerHash = context.ownerHash;
    res.locals.authProvider = roleplayxIdentity.provider;
    res.set("Cache-Control", "private, no-store");
    next();
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in to manage private image and avatar assets.");
  if (requestedProject !== undefined) {
    assertSameOriginForBridgeRequest(req);
    if (req.get("sec-fetch-site") === "cross-site") throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-site workspace access rejected.");
    if (typeof requestedProject !== "string") throw new SessionProblem(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
    await requireOwnedProject(userId, requestedProject);
    res.locals.tenantId = projectTenant(requestedProject);
    res.set("Cache-Control", "private, no-store");
    next();
    return;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
    if (origin && new URL(origin).host !== host) {
      throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-origin asset mutations are not allowed.");
    }
  }
  res.locals.tenantId = createHash("sha256").update(`avatar-router:user:${userId}`).digest("hex");
  next();
};
