import { Router, type IRouter } from "express";
import {
  CreateSessionBody, GetSessionParams, GetSessionResponse,
  ListProvidersResponse, ListAvatarsResponse, ListSessionsResponse,
  ListSessionEventsResponse, GetUsageResponse, GetSetupResponse,
} from "@workspace/api-zod";
import { getProviders, getAvatars, getSetupStatus } from "../lib/provider-registry";
import { playgroundOwner, playgroundLimit } from "../middlewares/playground-owner";
import {
  createMockSession, getOwnedSession, listOwnedSessions, mutateOwnedSession,
  getOwnedEvents, getOwnedUsage, presentSession,
} from "../lib/session-service";

const router: IRouter = Router();
router.use("/v1", playgroundLimit, playgroundOwner);
router.get("/v1/providers", (_req, res) => { res.json(ListProvidersResponse.parse(getProviders())); });
router.get("/v1/avatars", (_req, res) => { res.json(ListAvatarsResponse.parse(getAvatars())); });
router.get("/v1/setup", (_req, res) => { res.json(GetSetupResponse.parse(getSetupStatus())); });
router.get("/v1/sessions", async (_req, res): Promise<void> => {
  const rows = await listOwnedSessions(res.locals.ownerHash);
  res.json(ListSessionsResponse.parse(rows.map(presentSession)));
});
router.post("/v1/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid provider, avatar, or mode.", code: "INVALID_SESSION_INPUT" }); return;
  }
  const { providerId, avatarId, mode } = parsed.data;
  if (mode === "live") {
    res.status(409).json({
      code: "LIVE_VALIDATION_PENDING",
      error: "Live sessions are not enabled in this preliminary Playground. Configure LiveKit and provider Secrets, run the official-plugin worker smoke test, and add managed authentication before enabling paid sessions. Use Mock / Orbit to test lifecycle safely.",
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
router.post("/v1/sessions/:id/end", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.json(GetSessionResponse.parse(presentSession(await mutateOwnedSession(res.locals.ownerHash, id, "end"))));
});
router.post("/v1/sessions/:id/interrupt", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.json(GetSessionResponse.parse(presentSession(await mutateOwnedSession(res.locals.ownerHash, id, "interrupt"))));
});
router.get("/v1/sessions/:id/events", async (req, res): Promise<void> => {
  const { id } = GetSessionParams.parse(req.params);
  res.json(ListSessionEventsResponse.parse(await getOwnedEvents(res.locals.ownerHash, id)));
});
router.get("/v1/usage", async (_req, res): Promise<void> => {
  res.json(GetUsageResponse.parse(await getOwnedUsage(res.locals.ownerHash)));
});
export default router;
