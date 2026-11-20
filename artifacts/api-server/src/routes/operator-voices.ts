import { Router } from "express";
import { getAuth } from "@clerk/express";
import {
  GetOperatorVoiceCatalogResponse, SetOperatorVoiceGenderBody, SetOperatorVoiceGenderParams,
  SetOperatorVoiceGenderResponse,
} from "@workspace/api-zod";
import { SessionProblem } from "../lib/session-service";
import { voiceCatalog } from "../lib/voice-catalog";
import { trustedOperator } from "../middlewares/trusted-operator";

const router = Router();
router.use("/v1/operator/voice-catalog", trustedOperator);

router.get("/v1/operator/voice-catalog", async (_req, res): Promise<void> => {
  res.json(GetOperatorVoiceCatalogResponse.parse(await voiceCatalog.list()));
});

router.put("/v1/operator/voice-catalog/:providerId/:voiceId/gender", async (req, res): Promise<void> => {
  const params = SetOperatorVoiceGenderParams.safeParse(req.params);
  const body = SetOperatorVoiceGenderBody.safeParse(req.body);
  if (!params.success || !body.success) {
    throw new SessionProblem(400, "INVALID_VOICE_GENDER", "Provide a current voice ID and a valid gender classification.");
  }
  const { userId } = getAuth(req);
  if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in with a trusted operator account.");
  const voice = await voiceCatalog.setGender(params.data.providerId, params.data.voiceId, body.data.gender, userId);
  res.json(SetOperatorVoiceGenderResponse.parse(voice));
});

export default router;
