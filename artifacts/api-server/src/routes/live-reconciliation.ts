import { Router, type RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import {
  AttachLiveConversationIdBody, AttachLiveConversationIdParams,
  AttachLiveConversationIdResponse, ListLiveReconciliationResponse,
} from "@workspace/api-zod";
import { SessionProblem } from "../lib/session-service";
import { attachLiveConversationId, listLiveReconciliation } from "../lib/live-session-operator";
import { assertSameOriginForBridgeRequest } from "../middlewares/session-owner";

export function isTrustedLiveOperator(userId: string, configured = process.env.LIVE_SESSION_OPERATOR_IDS ?? "") {
  const allowed = new Set(configured.split(",").map(value => value.trim()).filter(Boolean));
  return allowed.has(userId);
}

const trustedOperator: RequestHandler = (req, res, next) => {
  if (res.locals.serviceApiIdentity || res.locals.roleplayxIdentity) {
    throw new SessionProblem(403, "TRUSTED_OPERATOR_REQUIRED", "Only a trusted signed-in operator can reconcile live sessions.");
  }
  const { userId } = getAuth(req);
  if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in with a trusted operator account.");
  if (!isTrustedLiveOperator(userId)) {
    throw new SessionProblem(403, "TRUSTED_OPERATOR_REQUIRED", "This signed-in account is not authorized for live session reconciliation.");
  }
  assertSameOriginForBridgeRequest(req);
  if (req.get("sec-fetch-site") === "cross-site") {
    throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-site operator requests are not allowed.");
  }
  res.set("Cache-Control", "private, no-store");
  next();
};

const router = Router();
router.use("/v1/operator/live-reconciliation", trustedOperator);

router.get("/v1/operator/live-reconciliation", async (_req, res): Promise<void> => {
  res.json(ListLiveReconciliationResponse.parse(await listLiveReconciliation()));
});

router.post("/v1/operator/live-reconciliation/:id", async (req, res): Promise<void> => {
  const params = AttachLiveConversationIdParams.safeParse(req.params);
  const body = AttachLiveConversationIdBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.confirmedFromProvider !== true) {
    throw new SessionProblem(400, "INVALID_RECONCILIATION_INPUT", "Provide a valid Tavus conversation ID and confirm that it was verified in the provider account.");
  }
  const { userId } = getAuth(req);
  if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in with a trusted operator account.");
  const result = await attachLiveConversationId(
    params.data.id,
    body.data.providerConversationId,
    userId,
  );
  res.status(202).json(AttachLiveConversationIdResponse.parse(result));
});

export default router;
