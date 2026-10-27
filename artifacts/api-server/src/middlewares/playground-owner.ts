import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const playgroundLimit = rateLimit({
  windowMs: 60_000, limit: 120,
  standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute.", code: "RATE_LIMITED" },
  // Socket IP is intentionally used instead of trusting arbitrary forwarded IPs.
  validate: { xForwardedForHeader: false },
  keyGenerator: (req, res) => res.locals.authProvider === "roleplayx"
    ? `roleplayx:${res.locals.ownerHash as string}`
    : ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown"),
});

/**
 * Anonymous local-demo ownership only; not user authentication or multi-tenancy.
 * It grants no paid creation, media token or audio access. The sole live
 * exception is stop-only cleanup for an already-owned session after auth loss.
 */
export const playgroundOwner: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.get("origin");
    const allowedHosts = [req.get("host"), req.get("x-forwarded-host")].filter(Boolean);
    let originMatches = !origin;
    try { if (origin) originMatches = allowedHosts.includes(new URL(origin).host); }
    catch { originMatches = false; }
    if (!originMatches || req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Cross-site mutation rejected.", code: "ORIGIN_REJECTED" });
      return;
    }
  }
  let capability: unknown = req.cookies?.avatar_playground;
  if (typeof capability !== "string" || !/^[a-f0-9]{64}$/.test(capability)) {
    capability = randomBytes(32).toString("hex");
    res.cookie("avatar_playground", capability, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/api",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
  res.locals.ownerHash = createHash("sha256").update(capability as string).digest("hex");
  res.set("Cache-Control", "private, no-store");
  next();
};
