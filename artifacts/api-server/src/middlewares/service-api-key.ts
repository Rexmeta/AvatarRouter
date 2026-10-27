import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { authenticateServiceKey, hashServiceValue } from "../lib/service-api-keys";
import { SessionProblem } from "../lib/session-service";

const verificationLimit = rateLimit({
  windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: { code: "RATE_LIMITED", message: "Too many authentication attempts. Try again later." } },
});

export const serviceApiKey: RequestHandler = (req, res, next) => {
  if (!req.path.toLowerCase().startsWith("/api/v1/")) { next(); return; }
  const authorization = req.get("authorization") ?? "";
  if (!/^Bearer\s+ar_sk_/i.test(authorization)) { next(); return; }
  verificationLimit(req, res, (error?: unknown) => {
    if (error) { next(error); return; }
    void (async () => {
      const secret = authorization.replace(/^Bearer\s+/i, "");
      const row = await authenticateServiceKey(secret);
      const user = req.get("x-avatar-user-id");
      if (user !== undefined && (!user.trim() || user.length > 256 || /[\u0000-\u001f\u007f]/.test(user))) {
        throw new SessionProblem(400, "INVALID_USER_CONTEXT", "X-Avatar-User-ID must be an opaque identifier of 1–256 characters.");
      }
      res.locals.serviceApiIdentity = {
        provider: "api-key",
        tenantId: hashServiceValue(`avatarrouter:project:${row.projectId}`),
        ownerHash: hashServiceValue(JSON.stringify(["avatarrouter:project-owner", row.projectId, user ? ["user", user] : ["project"]])),
        scopes: row.scopes,
      };
      res.locals.serviceKey = {
        projectId: row.projectId, projectName: row.projectName, expiresAt: row.expiresAt.toISOString(),
        scopes: row.scopes, userContext: !!user,
      };
      res.set("Cache-Control", "private, no-store");
      next();
    })().catch(next);
  });
};
