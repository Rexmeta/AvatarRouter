import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { SessionProblem } from "../lib/session-service";
import { assertSameOriginForBridgeRequest } from "./session-owner";
import { isTrustedLiveOperator } from "../lib/live-operator-access";

export const trustedOperator: RequestHandler = (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  if (res.locals.serviceApiIdentity || res.locals.roleplayxIdentity) {
    throw new SessionProblem(403, "TRUSTED_OPERATOR_REQUIRED", "This operation requires a trusted signed-in operator.");
  }
  const { userId } = getAuth(req);
  if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in with a trusted operator account.");
  if (!isTrustedLiveOperator(userId)) {
    throw new SessionProblem(403, "TRUSTED_OPERATOR_REQUIRED", "This signed-in account is not authorized for operator changes.");
  }
  assertSameOriginForBridgeRequest(req);
  if (req.get("sec-fetch-site") === "cross-site") {
    throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-site operator requests are not allowed.");
  }
  next();
};
