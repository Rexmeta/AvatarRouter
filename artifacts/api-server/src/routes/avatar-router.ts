import { Router, json, type IRouter } from "express";
import {
  CreateSessionBody, GetSessionParams, GetSessionResponse,
  ListProvidersResponse, ListAvatarsResponse, ListSessionsResponse,
  ListSessionEventsResponse, GetUsageResponse, GetSetupResponse,
  SendLiveAudioBody, GetLiveConnectionResponse, GetLiveLimitsResponse,
} from "@workspace/api-zod";
import { getProviders, getAvatars, getSetupStatus } from "../lib/provider-registry";
import { playgroundLimit } from "../middlewares/playground-owner";
import { sessionOwner } from "../middlewares/session-owner";
import { assetTenant } from "../middlewares/asset-tenant";
import { resolveSessionAsset } from "../lib/asset-service";
import { createStockSession, closeStockSession, liveConnection, sendStockAudio, interruptStockSession, liveLimits } from "../lib/live-sessions";
import { STOCK_AVATAR, validateLiveAudio } from "../lib/stock-policy";
import {
  createMockSession, getOwnedSession, listOwnedSessions, mutateOwnedSession,
  getOwnedEvents, getOwnedUsage, presentSession,
} from "../lib/session-service";

const router: IRouter = Router();
router.use("/v1", sessionOwner, playgroundLimit);
router.get("/v1/providers", (_req, res) => { res.json(ListProvidersResponse.parse(getProviders())); });
router.get("/v1/avatars", (_req, res) => { res.json(ListAvatarsResponse.parse(getAvatars())); });
router.get("/v1/setup", (_req, res) => { res.json(GetSetupResponse.parse(getSetupStatus())); });
router.get("/v1/live-limits", assetTenant, async (_req, res): Promise<void> => {
  res.json(GetLiveLimitsResponse.parse(await liveLimits(res.locals.tenantId)));
});
router.get("/v1/sessions", async (_req, res): Promise<void> => {
  const rows = await listOwnedSessions(res.locals.ownerHash);
  res.json(ListSessionsResponse.parse(rows.map(presentSession)));
});
router.post("/v1/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid provider, avatar, or mode.", code: "INVALID_SESSION_INPUT" }); return;
  }
  const { providerId, avatarId, avatarAssetId, mode, costConfirmed } = parsed.data;
  if (mode === "live" && providerId === "tavus" && avatarId === STOCK_AVATAR && !avatarAssetId) {
    assetTenant(req, res, () => {});
    const row = await createStockSession(res.locals.ownerHash, res.locals.tenantId, costConfirmed);
    res.status(201).json(GetSessionResponse.parse(presentSession(row)));
    return;
  }
  if (avatarAssetId) {
    // A browser capability never authorizes access to an owned provider avatar.
    assetTenant(req, res, () => {});
    if (mode !== "live") {
      res.status(400).json({ code: "ASSET_REQUIRES_LIVE_MODE", error: "A real avatar asset cannot be silently simulated as Mock." }); return;
    }
    const asset = await resolveSessionAsset(res.locals.tenantId, avatarAssetId);
    if (providerId !== asset.providerId || avatarId !== asset.avatarId) {
      res.status(400).json({ code: "AVATAR_ASSET_MISMATCH", error: "Use the asset's registered provider and provider avatar ID." }); return;
    }
  }
  if (mode === "live") {
    res.status(409).json({
      code: "LIVE_VALIDATION_PENDING",
      error: "Public live dispatch is not enabled. Private avatar assets require sign-in; an authorized image-derived avatar and browser LiveKit session still need real validation. Use Mock / Orbit to test lifecycle safely.",
    }); return;
  }
  if (providerId !== "mock" || avatarId !== "mock-orbit") {
    res.status(400).json({ code: "MOCK_PROVIDER_MISMATCH", error: "Mock mode requires providerId mock and avatarId mock-orbit. Real providers are never silently simulated." }); return;
  }
  const row = await createMockSession(res.locals.ownerHash);
  req.log.info({ sessionId: row.id, mode: row.mode }, "Mock session started");
  res.status(201).json(GetSessionResponse.parse(presentSession(row)));
});
router.get("/v1/sessions/:id", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.json(GetSessionResponse.parse(presentSession(await getOwnedSession(res.locals.ownerHash, id))));
});
router.get("/v1/sessions/:id/connection", assetTenant, async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.set("Cache-Control", "private, no-store");
  res.json(GetLiveConnectionResponse.parse(await liveConnection(res.locals.ownerHash, res.locals.tenantId, id)));
});
router.post("/v1/sessions/:id/audio", assetTenant, json({ limit: "330kb" }), async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  const input = SendLiveAudioBody.parse(req.body);
  await sendStockAudio(res.locals.ownerHash, res.locals.tenantId, id, validateLiveAudio(input));
  res.json({ accepted: true });
});
router.post("/v1/sessions/:id/end", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  const row = await getOwnedSession(res.locals.ownerHash, id);
  if (row.mode === "live") {
    // A stop-only capability survives Clerk expiry/sign-out. This same-browser
    // HttpOnly owner cookie cannot start paid sessions, fetch tokens or send audio.
    // playgroundOwner already rejects cross-site mutations and checks ownership.
    res.json(GetSessionResponse.parse(presentSession(await closeStockSession(res.locals.ownerHash, id))));
  } else res.json(GetSessionResponse.parse(presentSession(await mutateOwnedSession(res.locals.ownerHash, id, "end"))));
});
router.post("/v1/sessions/:id/interrupt", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  const row = await getOwnedSession(res.locals.ownerHash, id);
  if (row.mode === "live") {
    assetTenant(req, res, () => {});
    res.json(GetSessionResponse.parse(presentSession(await interruptStockSession(res.locals.ownerHash, res.locals.tenantId, id))));
  } else res.json(GetSessionResponse.parse(presentSession(await mutateOwnedSession(res.locals.ownerHash, id, "interrupt"))));
});
router.get("/v1/sessions/:id/events", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.json(ListSessionEventsResponse.parse(await getOwnedEvents(res.locals.ownerHash, id)));
});
router.get("/v1/usage", async (_req, res): Promise<void> => {
  res.json(GetUsageResponse.parse(await getOwnedUsage(res.locals.ownerHash)));
});
export default router;
