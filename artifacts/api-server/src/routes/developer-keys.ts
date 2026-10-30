import { Router, type RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { CreateDeveloperKeyBody, ListDeveloperKeysResponse, CreateDeveloperKeyResponse, RotateDeveloperKeyResponse, CheckServiceApiKeyResponse } from "@workspace/api-zod";
import { createDeveloperKey, developerOwnerHash, listDeveloperKeys, revokeDeveloperKey, rotateDeveloperKey } from "../lib/service-api-keys";
import { SessionProblem } from "../lib/session-service";
import { assertSameOriginForBridgeRequest } from "../middlewares/session-owner";
import { integrationContract } from "../lib/integration-contract";

const router = Router();
const owner: RequestHandler = (req, res, next) => {
  if (res.locals.serviceApiIdentity || res.locals.roleplayxIdentity) {
    throw new SessionProblem(403, "INTERACTIVE_LOGIN_REQUIRED", "Only the signed-in Studio owner can manage API keys.");
  }
  const { userId } = getAuth(req);
  if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in to manage integration keys.");
  assertSameOriginForBridgeRequest(req);
  if (req.get("sec-fetch-site") === "cross-site") throw new SessionProblem(403, "ORIGIN_REJECTED", "Cross-site key management is not allowed.");
  res.locals.developerOwner = developerOwnerHash(userId);
  res.set("Cache-Control", "private, no-store");
  next();
};
router.use("/v1/developer", owner, rateLimit({ windowMs: 60_000, limit: 60, validate: { xForwardedForHeader: false }, standardHeaders: "draft-7", legacyHeaders: false }));
router.get("/v1/developer/keys", async (_req, res) => {
  res.json(ListDeveloperKeysResponse.parse(await listDeveloperKeys(res.locals.developerOwner)));
});
router.post("/v1/developer/keys", async (req, res) => {
  const parsed = CreateDeveloperKeyBody.safeParse(req.body);
  if (!parsed.success) throw new SessionProblem(400, "INVALID_KEY_INPUT", "Provide a project name, allowed scopes, and an expiry between 1 and 365 days.");
  if (!parsed.data.projectName.trim()) throw new SessionProblem(400, "INVALID_KEY_INPUT", "Project name must not be blank.");
  res.status(201).json(CreateDeveloperKeyResponse.parse(await createDeveloperKey(res.locals.developerOwner, {
    ...parsed.data, projectName: parsed.data.projectName.trim(), expiresInDays: parsed.data.expiresInDays ?? 90,
  })));
});
router.post("/v1/developer/keys/:id/rotate", async (req, res) => {
  res.json(RotateDeveloperKeyResponse.parse(await rotateDeveloperKey(res.locals.developerOwner, req.params.id)));
});
router.delete("/v1/developer/keys/:id", async (req, res) => {
  await revokeDeveloperKey(res.locals.developerOwner, req.params.id);
  res.status(204).end();
});
router.get("/v1/auth/check", (req, res) => {
  if (!res.locals.serviceApiIdentity) throw new SessionProblem(401, "API_KEY_REQUIRED", "Provide Authorization: Bearer <project API key>.");
  assertSameOriginForBridgeRequest(req);
  res.set("Cache-Control", "private, no-store");
  res.json(CheckServiceApiKeyResponse.parse({
    authenticated: true, authType: "api-key", ...res.locals.serviceKey,
    integration: integrationContract(),
  }));
});
export default router;
