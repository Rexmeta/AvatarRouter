import { Router, json, type IRouter } from "express";
import {
  CreateSessionBody, GetSessionParams, GetSessionResponse,
  ListProvidersResponse, ListAvatarsResponse, ListSessionsResponse,
  ListSessionEventsResponse, GetUsageResponse, GetSetupResponse,
  SendLiveAudioBody, GetLiveConnectionResponse, GetLiveLimitsResponse,
  GetTavusFullConnectionResponse, GetTavusFinalTranscriptResponse,
} from "@workspace/api-zod";
import { getProviders, getAvatars, getSetupStatus } from "../lib/provider-registry";
import { playgroundLimit } from "../middlewares/playground-owner";
import { sessionOwner } from "../middlewares/session-owner";
import { assetTenant } from "../middlewares/asset-tenant";
import { resolveSessionAsset } from "../lib/asset-service";
import { createStockSession, closeStockSession, liveConnection, fullConnection, anamConnection, clientConnection, sendStockAudio, interruptStockSession, liveLimits } from "../lib/live-sessions";
import { CreateAnamConnectionParams, CreateAnamConnectionResponse, CreateClientConnectionResponse, GetLiveLimitsQueryParams } from "@workspace/api-zod";
import { ANAM_AVATAR } from "../lib/anam-runtime";
import { STOCK_AVATAR, validateLiveAudio } from "../lib/stock-policy";
import { integrationIdentity } from "../lib/integration-identity";
import { SessionProblem } from "../lib/session-service";
import { FinalTranscriptProblem } from "../lib/tavus-final-transcript";
import { readSessionTranscript } from "../lib/session-transcript";
import { tavusRoleplayOptions } from "../lib/roleplay-context";
import {
  createMockSession, getOwnedSession, listOwnedSessions, mutateOwnedSession,
  getOwnedEvents, getOwnedUsage, presentSession,
} from "../lib/session-service";

const router: IRouter = Router();
router.use("/v1", sessionOwner, playgroundLimit);
router.get("/v1/providers", (_req, res) => { res.json(ListProvidersResponse.parse(getProviders())); });
router.get("/v1/avatars", (_req, res) => { res.json(ListAvatarsResponse.parse(getAvatars())); });
router.get("/v1/setup", (_req, res) => { res.json(GetSetupResponse.parse(getSetupStatus())); });
router.get("/v1/live-limits", assetTenant, async (req, res): Promise<void> => {
  const { providerId, pipeline } = GetLiveLimitsQueryParams.parse(req.query);
  if (pipeline && (providerId === "anam" ? pipeline !== "anam_full" : pipeline === "anam_full")) {
    throw new SessionProblem(400, "INVALID_PIPELINE_CONFIG", "Provider and pipeline do not match.");
  }
  res.json(GetLiveLimitsResponse.parse(await liveLimits(res.locals.tenantId, providerId, pipeline)));
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
  const { providerId, avatarId, avatarAssetId, mode, costConfirmed, purpose } = parsed.data;
  const { roleplay } = parsed.data;
  // A common roleplay request selects the native engine internally. Legacy
  // pipeline/fullPipeline requests remain supported without silent fallback.
  const pipeline = (roleplay || parsed.data.fullPipeline) && req.body.pipeline === undefined
    ? providerId === "anam" ? "anam_full" : providerId === "tavus" ? "tavus_full" : parsed.data.pipeline
    : parsed.data.pipeline;
  if (roleplay && (mode !== "live" || !["anam_full", "tavus_full"].includes(pipeline))) {
    throw new SessionProblem(400, "INVALID_ROLEPLAY_PIPELINE", "roleplay requires a native Anam or Tavus live conversation.");
  }
  if (roleplay && parsed.data.fullPipeline) {
    throw new SessionProblem(400, "INVALID_PIPELINE_CONFIG", "Use roleplay or fullPipeline, not both.");
  }
  const baseFullPipeline = roleplay && pipeline === "tavus_full" ? tavusRoleplayOptions(roleplay) : parsed.data.fullPipeline;
  const assignmentName = parsed.data.scenarioAssignmentName;
  if (assignmentName !== undefined && (mode !== "live" || providerId !== "tavus" || pipeline !== "tavus_full" || !baseFullPipeline || !assignmentName.trim())) {
    throw new SessionProblem(400, "INVALID_SCENARIO_ASSIGNMENT_NAME", "scenarioAssignmentName requires a nonblank name and a configured Tavus full-pipeline live request.");
  }
  const fullPipeline = baseFullPipeline ? {
    ...baseFullPipeline, ...(assignmentName !== undefined ? { conversationName: assignmentName } : {}),
  } : undefined;
  if (fullPipeline && !fullPipeline.systemPrompt.trim()) {
    throw new SessionProblem(400, "INVALID_ROLEPLAY_CONTEXT", "fullPipeline.systemPrompt must not be blank.");
  }
  if (roleplay && (!roleplay.persona.trim() || !roleplay.scenario.trim() || (roleplay.language !== undefined && !roleplay.language.trim()) || (roleplay.greeting !== undefined && !roleplay.greeting.trim()))) {
    throw new SessionProblem(400, "INVALID_ROLEPLAY_CONTEXT", "Roleplay fields must not be blank.");
  }
  if (pipeline === "anam_full") {
    if (mode !== "live" || providerId !== "anam" || avatarId !== ANAM_AVATAR || avatarAssetId || purpose !== "conversation") {
      throw new SessionProblem(400, "INVALID_ANAM_CONFIG", "anam_full requires the registered Anam template and live conversation mode, not a custom asset.");
    }
    // This async guard must settle before admission. Otherwise an expired
    // login rejects outside Express and can crash the API process.
    await assetTenant(req, res, () => {});
    if (integrationIdentity(res) && !roleplay && !fullPipeline) {
      throw new SessionProblem(400, "ROLEPLAY_CONTEXT_REQUIRED", "Anam integration conversations require roleplay or fullPipeline context. Send the same systemPrompt, context and greeting used for Tavus; the router adapts them. No paid session was started.");
    }
    if (parsed.data.fullPipeline?.voiceId) {
      throw new SessionProblem(400, "ANAM_UNSUPPORTED_VOICE", "Do not send a Tavus voiceId to Anam. Use the server-selected template voice.");
    }
    const row = await createStockSession(res.locals.ownerHash, res.locals.tenantId, costConfirmed, undefined, purpose, fullPipeline, true, roleplay);
    res.status(201).json(GetSessionResponse.parse(presentSession(row)));
    return;
  }
  if ((pipeline === "tavus_full" && (mode !== "live" || providerId !== "tavus" || purpose === "validation" || !fullPipeline)) ||
      (pipeline !== "tavus_full" && fullPipeline)) {
    res.status(400).json({ code: "INVALID_PIPELINE_CONFIG", error: "tavus_full requires Tavus live conversation mode and fullPipeline options. Existing validation remains external_audio." }); return;
  }
  if (mode === "live" && providerId === "tavus" && avatarId === STOCK_AVATAR && !avatarAssetId) {
    await assetTenant(req, res, () => {});
    const row = await createStockSession(res.locals.ownerHash, res.locals.tenantId, costConfirmed, undefined, purpose, fullPipeline);
    res.status(201).json(GetSessionResponse.parse(presentSession(row)));
    return;
  }
  if (avatarAssetId) {
    // A browser capability never authorizes access to an owned provider avatar.
    await assetTenant(req, res, () => {});
    if (mode !== "live") {
      res.status(400).json({ code: "ASSET_REQUIRES_LIVE_MODE", error: "A real avatar asset cannot be silently simulated as Mock." }); return;
    }
    const asset = await resolveSessionAsset(res.locals.tenantId, avatarAssetId);
    if (providerId !== asset.providerId || avatarId !== asset.avatarId) {
      res.status(400).json({ code: "AVATAR_ASSET_MISMATCH", error: "Use the asset's registered provider and provider avatar ID." }); return;
    }
    const identity = integrationIdentity(res);
    if (purpose === "validation" && identity && !identity.scopes.includes("assets:write")) {
      throw new SessionProblem(403, "ASSET_VALIDATION_FORBIDDEN", "Validation sessions require assets:write in addition to sessions:create.");
    }
    const row = await createStockSession(res.locals.ownerHash, res.locals.tenantId, costConfirmed, avatarAssetId, purpose, fullPipeline);
    res.status(201).json(GetSessionResponse.parse(presentSession(row)));
    return;
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
  const row = await createMockSession(res.locals.ownerHash, res.locals.tenantId);
  req.log.info({ sessionId: row.id, mode: row.mode }, "Mock session started");
  res.status(201).json(GetSessionResponse.parse(presentSession(row)));
});
router.get("/v1/sessions/:id", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.json(GetSessionResponse.parse(presentSession(await getOwnedSession(res.locals.ownerHash, id))));
});
router.post("/v1/sessions/:id/anam-connection", assetTenant, async (req, res): Promise<void> => {
  const { id } = CreateAnamConnectionParams.parse(req.params);
  res.set("Cache-Control", "private, no-store");
  res.json(CreateAnamConnectionResponse.parse(await anamConnection(res.locals.ownerHash, res.locals.tenantId, id)));
});

router.post("/v1/sessions/:id/client-connection", assetTenant, async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.set("Cache-Control", "private, no-store");
  res.json(CreateClientConnectionResponse.parse(await clientConnection(res.locals.ownerHash, res.locals.tenantId, id)));
});

router.get("/v1/sessions/:id/full-connection", assetTenant, async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.set("Cache-Control", "private, no-store");
  res.json(GetTavusFullConnectionResponse.parse(await fullConnection(res.locals.ownerHash, res.locals.tenantId, id)));
});
router.get("/v1/sessions/:id/transcript", assetTenant, async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.set("Cache-Control", "private, no-store");
  const row = await getOwnedSession(res.locals.ownerHash, id);
  try {
    res.json(GetTavusFinalTranscriptResponse.parse(await readSessionTranscript(row, res.locals.ownerHash, res.locals.tenantId)));
  } catch (error) {
    if (error instanceof FinalTranscriptProblem) throw new SessionProblem(error.status, error.code, error.code);
    throw error;
  }
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
    await assetTenant(req, res, () => {});
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
