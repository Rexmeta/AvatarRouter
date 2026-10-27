import { createHash } from "node:crypto";
import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { SessionProblem } from "../lib/session-service";
import { mapRoleplayxIdentity, type RoleplayxIdentity } from "../lib/roleplayx-auth";
import { assertSameOriginForBridgeRequest, requiredRoleplayxScope } from "./session-owner";

// Personal, isolated tenants for now. No client-supplied tenant identifiers.
export const assetTenant: RequestHandler = (req, res, next) => {
  const roleplayxIdentity = res.locals.roleplayxIdentity as RoleplayxIdentity | undefined;
  if (roleplayxIdentity) {
    assertSameOriginForBridgeRequest(req);
    if (req.get("sec-fetch-site") === "cross-site") {
      throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-site requests are not allowed.");
    }
    const requiredScope = requiredRoleplayxScope(req.method, req.originalUrl.split("?")[0] ?? "");
    if (!requiredScope || !roleplayxIdentity.scopes.includes(requiredScope)) {
      throw new SessionProblem(403, "INSUFFICIENT_ROLEPLAYX_SCOPE", "The delegated identity does not have permission for this operation.");
    }
    const context = mapRoleplayxIdentity(roleplayxIdentity);
    res.locals.tenantId = context.tenantId;
    res.locals.ownerHash = context.ownerHash;
    res.locals.authProvider = "roleplayx";
    res.set("Cache-Control", "private, no-store");
    next();
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in to manage private image and avatar assets.");
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
