import { createHash } from "node:crypto";
import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { SessionProblem } from "../lib/session-service";

// Personal, isolated tenants for now. No client-supplied tenant identifiers.
export const assetTenant: RequestHandler = (req, res, next) => {
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
