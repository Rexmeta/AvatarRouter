import { providerReasonStates, safeProviderCodes, type ProviderReasonState } from "./provider-rejection-diagnostic";
import type { AvatarProvisioningFailure } from "@workspace/api-zod";

const codes = [
  "PROVIDER_NOT_CONFIGURED", "PROVIDER_NETWORK_ERROR", "PROVIDER_AUTHENTICATION_FAILED",
  "PROVIDER_ENTITLEMENT_REQUIRED", "PROVIDER_RATE_LIMITED", "PROVIDER_RESOURCE_IN_USE",
  "PROVIDER_UNAVAILABLE", "PROVIDER_INPUT_REJECTED", "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_TRAINING_FAILED", "PROVIDER_STATUS_UNKNOWN", "SOURCE_IMAGE_MISSING",
  "PROVIDER_ID_MISSING", "PROVISIONING_INTERNAL_ERROR", "SUBMISSION_INTERRUPTED", "TRAINING_IMAGE_PREPARATION_FAILED",
  "TRAINING_IMAGE_AI_UNAVAILABLE", "TRAINING_IMAGE_INSPECTION_FAILED", "TRAINING_IMAGE_SUBJECT_UNSUPPORTED",
  "TRAINING_IMAGE_IDENTITY_UNCERTAIN", "TRAINING_IMAGE_REGENERATION_FAILED", "TRAINING_IMAGE_FRAMING_UNRESOLVED",
] as const;
type Evidence = {
  stage: "create" | "status" | "delete";
  httpStatus: number | null;
  providerCode: typeof safeProviderCodes[number] | null;
  reasonState: ProviderReasonState;
};

/** Existing error_code column, fixed grammar only; no schema migration or raw provider text. */
export function storeProvisioningFailure(code: string, evidence?: Evidence) {
  if (!codes.includes(code as typeof codes[number])) code = "PROVISIONING_INTERNAL_ERROR";
  if (!evidence) return code;
  return `${code}:${evidence.stage}:HTTP_${evidence.httpStatus ?? 0}:${evidence.providerCode ?? "none"}:${evidence.reasonState}`;
}

export function decodeProvisioningFailure(value: string | null) {
  if (!value) return null;
  const [code, stage, http, providerCode, reasonState, extra] = value.split(":");
  if (!codes.includes(code as typeof codes[number])) return null;
  if (!stage) return { code, stage: "unknown" as const, httpStatus: null, providerCode: null, reasonState: "not_retained" as const };
  if (extra !== undefined || !["create", "status", "delete"].includes(stage) ||
    !/^HTTP_(0|[1-5]\d\d)$/.test(http ?? "") ||
    providerCode !== "none" && !(safeProviderCodes as readonly string[]).includes(providerCode!) ||
    !(providerReasonStates as readonly string[]).includes(reasonState!)) return null;
  return {
    code, stage: stage as Evidence["stage"], httpStatus: http === "HTTP_0" ? null : Number(http!.slice(5)),
    providerCode: providerCode === "none" ? null : providerCode as Evidence["providerCode"],
    reasonState: reasonState as ProviderReasonState,
  };
}

export function presentProvisioningFailure(row: {
  errorCode: string | null; status: string; providerAvatarId: string | null;
}): AvatarProvisioningFailure | null {
  const info = decodeProvisioningFailure(row.errorCode);
  if (!info) return null;
  const unknownCreation = ["submitting", "reconciliation_required"].includes(row.status);
  const framing = info.providerCode === "training_image_framing_invalid";
  const preparation = info.code.startsWith("TRAINING_IMAGE_");
  const preparationMessages: Record<string, [string, string]> = {
    TRAINING_IMAGE_AI_UNAVAILABLE: ["Gemini image preparation is not configured. No avatar creation was sent.", "Gemini 이미지 보정 연결이 설정되지 않았습니다. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_INSPECTION_FAILED: ["Gemini could not verify the training image. No avatar creation was sent.", "Gemini 이미지 조건 검사에 실패했습니다. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_SUBJECT_UNSUPPORTED: ["A clearly adult single subject is required. No avatar creation was sent.", "성인 1명인 이미지가 필요합니다. 대상 조건을 확인하지 못해 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_IDENTITY_UNCERTAIN: ["The subject identity could not be retained or verified. No avatar creation was sent.", "원본 얼굴의 식별 가능성 또는 보정 후 외형 일관성을 확인하지 못했습니다. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_REGENERATION_FAILED: ["Gemini could not produce a valid edited image. No avatar creation was sent.", "Gemini가 유효한 보정 이미지를 생성하지 못했습니다. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_FRAMING_UNRESOLVED: ["The corrected image still fails training framing rules. No avatar creation was sent.", "Gemini 보정 뒤에도 학습용 구도 조건을 충족하지 못했습니다. 아바타 생성은 전송하지 않았습니다."],
  };
  const category = unknownCreation ? "reconciliation" : framing || preparation ? "input"
    : info.httpStatus === 401 || info.code === "PROVIDER_AUTHENTICATION_FAILED" ? "authentication"
    : info.httpStatus === 402 || ["insufficient_credits", "out_of_credits"].includes(info.providerCode ?? "") ? "billing"
    : info.code === "PROVIDER_TRAINING_FAILED" ? "training"
    : info.httpStatus === 403 || info.code === "PROVIDER_ENTITLEMENT_REQUIRED" ? "permission_or_plan"
    : info.code === "PROVIDER_RATE_LIMITED" ? "provider_limit"
    : info.code === "PROVIDER_INPUT_REJECTED" ? "input"
    : "unknown";
  const messages = {
    training: ["The provider created a face reference but reported training failure. This does not establish a billing or plan problem.",
      "제공자가 얼굴 참조를 발급했지만 학습 실패를 반환했습니다. 이 결과만으로 비용·요금제 문제라고 판단할 수 없습니다."],
    authentication: ["The provider rejected its API credential. Ask the AvatarRouter operator to check the provider key.",
      "제공자가 API 인증을 거절했습니다. AvatarRouter 운영자가 제공자 키를 확인해야 합니다."],
    billing: ["The provider reported a payment or credit restriction. Check the account linked to the server key.",
      "제공자가 결제·크레딧 제한을 반환했습니다. 서버 키에 연결된 제공자 계정을 확인하세요."],
    permission_or_plan: ["The provider denied access. Check permissions and custom-training entitlement; insufficient credits are not confirmed.",
      "제공자가 접근을 거절했습니다. 권한·커스텀 생성 허용 범위를 확인하세요. 크레딧 부족이 확정된 것은 아닙니다."],
    provider_limit: ["The provider reported a request limit. Do not automatically create another face.",
      "제공자 요청 한도가 적용됐습니다. 새 얼굴을 자동 재생성하지 마세요."],
    input: ["The provider rejected the creation input. Review image and voice settings before any new creation.",
      "제공자가 생성 입력을 거절했습니다. 새 생성 전에 이미지·음성 설정을 확인하세요."],
    reconciliation: ["Creation outcome is uncertain. An operator must locate the existing resource before any retry.",
      "생성 결과가 불확실합니다. 재시도 전에 운영자가 기존 자원 생성 여부를 확인해야 합니다."],
    unknown: ["The operation failed; a specific cause was not retained. Check the existing asset without recreating it.",
      "작업이 실패했지만 구체적인 원인은 보존되지 않았습니다. 재생성하지 말고 기존 자산을 확인하세요."],
  };
  return {
    code: info.code, stage: info.stage, category,
    providerHttpStatus: info.httpStatus, providerErrorCode: info.providerCode,
    reasonState: info.reasonState,
    message: preparation ? preparationMessages[info.code]?.[0] ?? "The router could not prepare the training image. No provider creation request was sent. Check the source image and private storage." : framing ? "Tavus rejected the image framing or arm pose. Use a chest-up portrait cropped at or above the navel, with hands at or below chest height. Keep the head and both shoulders visible. Upload a new image version; do not retry the unchanged image." : messages[category][0]!,
    messageKo: preparation ? preparationMessages[info.code]?.[1] ?? "라우터의 학습 이미지 보정·저장에 실패했습니다. 제공자 생성 요청은 전송하지 않았습니다. 원본 이미지와 비공개 저장소를 확인하세요." : framing ? "Tavus가 이미지 구도·팔 자세를 거절했습니다. 배꼽 또는 그 위에서 자른 가슴 위 중심의 상반신 사진을 사용하고, 손·팔은 가슴 높이 이하로 낮추세요. 머리와 양쪽 어깨는 프레임 안에 유지하세요. 같은 이미지로 재시도하지 말고 수정된 새 이미지 버전을 등록하세요." : messages[category][1]!,
    automaticRetryAllowed: false,
    nextAction: unknownCreation ? "operator_reconcile" : framing || preparation ? "replace_image" : row.providerAvatarId ? "inspect_existing_asset" : "operator_review",
    creationOutcome: row.providerAvatarId ? "created" : unknownCreation ? "unknown" : preparation ? "not_created"
      : info.stage === "create" && info.httpStatus !== null && info.httpStatus >= 400 && info.httpStatus < 500 && info.httpStatus !== 408 ? "not_created" : "unknown",
  };
}
