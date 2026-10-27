import type { RequestHandler } from "express";
import { SessionProblem } from "../lib/session-service";
import { mapRoleplayxIdentity, type RoleplayxIdentity } from "../lib/roleplayx-auth";
import { playgroundOwner } from "./playground-owner";

export function requiredRoleplayxScope(method: string, path: string): string | undefined {
  // Express accepts case-insensitive routes and trailing slashes. Authorization must do the same.
  method = method === "HEAD" ? "GET" : method;
  path = path.toLowerCase().replace(/\/+$/, "");
  if (path === "/api/v1/live-limits" && method === "GET") return "live-limits:read";
  if (path === "/api/v1/sessions" && method === "GET") return "sessions:read";
  if (path === "/api/v1/sessions" && method === "POST") return "sessions:create";
  if (/^\/api\/v1\/sessions\/[^/]+$/.test(path) && method === "GET") return "sessions:read";
  if (/^\/api\/v1\/sessions\/[^/]+\/events$/.test(path) && method === "GET") return "sessions:read";
  if (path === "/api/v1/usage" && method === "GET") return "sessions:read";
  if (/^\/api\/v1\/sessions\/[^/]+\/connection$/.test(path) && method === "GET") return "sessions:connect";
  if (/^\/api\/v1\/sessions\/[^/]+\/audio$/.test(path) && method === "POST") return "sessions:audio";
  if (/^\/api\/v1\/sessions\/[^/]+\/interrupt$/.test(path) && method === "POST") return "sessions:interrupt";
  if (/^\/api\/v1\/sessions\/[^/]+\/end$/.test(path) && method === "POST") return "sessions:end";
  if (/^\/api\/v1\/(assets|avatar-assets)(\/|$)/.test(path)) return ["GET", "HEAD"].includes(method) ? "assets:read" : "assets:write";
  if (method === "GET" && ["/api/v1/providers", "/api/v1/avatars", "/api/v1/setup", "/api/v1/provisioning/providers"].includes(path)) return undefined;
  // A newly added route must explicitly opt in instead of inheriting delegated access.
  return "unrecognized:route";
}

export function assertSameOriginForBridgeRequest(req: Parameters<RequestHandler>[0]) {
  const origin = req.get("origin");
  if (!origin) return;
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
  try {
    if (new URL(origin).host === host) return;
  } catch { /* Reject malformed origins below. */ }
  throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-origin requests are not allowed.");
}

export const sessionOwner: RequestHandler = (req, res, next) => {
  const identity = res.locals.roleplayxIdentity as RoleplayxIdentity | undefined;
  if (!identity) {
    playgroundOwner(req, res, next);
    return;
  }

  try {
    assertSameOriginForBridgeRequest(req);
    if (req.get("sec-fetch-site") === "cross-site") {
      throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-site requests are not allowed.");
    }
    const requiredScope = requiredRoleplayxScope(req.method, req.originalUrl.split("?")[0] ?? "");
    if (requiredScope && !identity.scopes.includes(requiredScope)) {
      throw new SessionProblem(403, "INSUFFICIENT_ROLEPLAYX_SCOPE", "The delegated identity does not have permission for this operation.");
    }

    const context = mapRoleplayxIdentity(identity);
    res.locals.ownerHash = context.ownerHash;
    res.locals.tenantId = context.tenantId;
    res.locals.authProvider = "roleplayx";
    res.set("Cache-Control", "private, no-store");
    next();
  } catch (error) { next(error); }
};

