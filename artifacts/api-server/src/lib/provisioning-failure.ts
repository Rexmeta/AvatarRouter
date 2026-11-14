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
  "TRAINING_IMAGE_AI_AUTHENTICATION_FAILED", "TRAINING_IMAGE_AI_PERMISSION_DENIED", "TRAINING_IMAGE_AI_QUOTA_EXCEEDED",
  "TRAINING_IMAGE_AI_MODEL_UNAVAILABLE", "TRAINING_IMAGE_AI_BILLING_REQUIRED", "TRAINING_IMAGE_AI_SERVICE_UNAVAILABLE",
  "TRAINING_IMAGE_AI_CONTENT_BLOCKED",
  "TRAINING_IMAGE_AI_INSPECTION_MODEL_UNAVAILABLE", "TRAINING_IMAGE_AI_REGENERATION_MODEL_UNAVAILABLE",
  "TRAINING_IMAGE_AI_VERIFICATION_MODEL_UNAVAILABLE",
  "TRAINING_IMAGE_AI_INSPECTION_MODEL_INVALID", "TRAINING_IMAGE_AI_REGENERATION_MODEL_INVALID",
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
    TRAINING_IMAGE_AI_AUTHENTICATION_FAILED: ["Gemini rejected the image-preparation credential. Check GEMINI_API_KEY or the selected managed connection. No avatar creation was sent.", "Gemini가 이미지 보정용 인증을 거절했습니다. GEMINI_API_KEY 또는 선택된 관리형 연결을 확인하세요. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_PERMISSION_DENIED: ["Gemini denied image preparation. Check API/project/model access; a credit shortage is not confirmed. No avatar creation was sent.", "Gemini 이미지 보정 접근이 거절됐습니다. API·프로젝트·모델 권한을 확인하세요. 잔액 부족이 확정된 것은 아닙니다. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_QUOTA_EXCEEDED: ["Gemini reported a quota or rate limit. Check the selected account's limits; this alone does not prove a billing shortage. No avatar creation was sent.", "Gemini가 할당량·요청 한도를 반환했습니다. 선택된 계정의 한도를 확인하세요. 이 응답만으로 잔액 부족을 확정할 수 없습니다. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_MODEL_UNAVAILABLE: ["A Gemini model error was retained without its original phase or HTTP status. It cannot establish which model failed or whether billing was involved. Ask the router operator to check model diagnostics; no avatar creation was sent.", "Gemini 모델 오류는 보존됐지만 원래 실패 단계·HTTP 상태는 남아 있지 않습니다. 검사 모델·이미지 모델 중 어느 쪽인지, 비용 문제인지 확정할 수 없습니다. 라우터 운영자가 모델 진단을 확인해야 합니다. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_INSPECTION_MODEL_INVALID: ["The inspection model setting has invalid syntax. Check GEMINI_TRAINING_INSPECTION_MODEL. No Gemini or avatar creation request was sent.", "검사 모델 설정 형식이 잘못됐습니다. GEMINI_TRAINING_INSPECTION_MODEL 값을 확인하세요. Gemini·아바타 생성 요청은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_REGENERATION_MODEL_INVALID: ["The image generation model setting has invalid syntax. Check GEMINI_TRAINING_IMAGE_MODEL. No Gemini or avatar creation request was sent.", "이미지 생성 모델 설정 형식이 잘못됐습니다. GEMINI_TRAINING_IMAGE_MODEL 값을 확인하세요. Gemini·아바타 생성 요청은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_INSPECTION_MODEL_UNAVAILABLE: ["Gemini returned HTTP 404 during seed inspection, before image regeneration. Check the inspection model and production endpoint/access. This does not establish a billing shortage. No avatar creation was sent.", "시드 검사 단계에서 Gemini HTTP 404가 반환됐습니다. 이미지 재생성 전 실패입니다. 검사 모델과 운영 서버의 API 주소·접근 권한을 확인하세요. 비용 소진으로 확정할 수 없으며 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_REGENERATION_MODEL_UNAVAILABLE: ["Gemini returned HTTP 404 during image regeneration. Check the image generation model and production endpoint/access. No avatar creation was sent.", "이미지 재생성 단계에서 Gemini HTTP 404가 반환됐습니다. 이미지 생성 모델과 운영 서버의 API 주소·접근 권한을 확인하세요. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_VERIFICATION_MODEL_UNAVAILABLE: ["Gemini returned HTTP 404 during final identity/framing verification. The generated image was not sent to the avatar provider. Check the inspection model and production endpoint/access.", "생성 이미지의 최종 얼굴·구도 검증 단계에서 Gemini HTTP 404가 반환됐습니다. 검사 모델과 운영 서버의 API 주소·접근 권한을 확인하세요. 생성 이미지는 아바타 제공자에게 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_BILLING_REQUIRED: ["Gemini explicitly requested payment. Check billing on the selected image-preparation account. No avatar creation was sent.", "Gemini가 결제 필요 응답을 반환했습니다. 이미지 보정에 사용하는 계정의 결제를 확인하세요. 아바타 생성은 전송하지 않았습니다."],
    TRAINING_IMAGE_AI_SERVICE_UNAVAILABLE: ["Gemini returned a service error. No avatar creation was sent; do not automatically recreate an avatar.", "Gemini가 서비스 오류를 반환했습니다. 아바타 생성은 전송하지 않았으며 자동 재생성하지 않습니다."],
    TRAINING_IMAGE_AI_CONTENT_BLOCKED: ["Gemini blocked image generation under its content policy. Use an eligible image; no avatar creation was sent.", "Gemini 콘텐츠 정책으로 이미지 재생성이 차단됐습니다. 허용되는 원본 이미지를 사용하세요. 아바타 생성은 전송하지 않았습니다."],
  };
  const aiCategory = ["TRAINING_IMAGE_AI_AUTHENTICATION_FAILED", "TRAINING_IMAGE_AI_UNAVAILABLE"].includes(info.code) ? "authentication"
    : info.code.endsWith("MODEL_INVALID") ? "input"
    : (info.code === "TRAINING_IMAGE_AI_PERMISSION_DENIED" || info.code.startsWith("TRAINING_IMAGE_AI_") && info.code.endsWith("MODEL_UNAVAILABLE")) ? "permission_or_plan"
    : info.code === "TRAINING_IMAGE_AI_QUOTA_EXCEEDED" ? "provider_limit"
    : info.code === "TRAINING_IMAGE_AI_BILLING_REQUIRED" ? "billing"
    : info.code === "TRAINING_IMAGE_AI_SERVICE_UNAVAILABLE" ? "unknown" : undefined;
  const aiReview = (info.code.startsWith("TRAINING_IMAGE_AI_") && info.code !== "TRAINING_IMAGE_AI_CONTENT_BLOCKED")
    || ["TRAINING_IMAGE_INSPECTION_FAILED", "TRAINING_IMAGE_REGENERATION_FAILED"].includes(info.code);
  const category = unknownCreation ? "reconciliation" : aiCategory ?? (framing || preparation ? "input"
    : info.httpStatus === 401 || info.code === "PROVIDER_AUTHENTICATION_FAILED" ? "authentication"
    : info.httpStatus === 402 || ["insufficient_credits", "out_of_credits"].includes(info.providerCode ?? "") ? "billing"
    : info.code === "PROVIDER_TRAINING_FAILED" ? "training"
    : info.httpStatus === 403 || info.code === "PROVIDER_ENTITLEMENT_REQUIRED" ? "permission_or_plan"
    : info.code === "PROVIDER_RATE_LIMITED" ? "provider_limit"
    : info.code === "PROVIDER_INPUT_REJECTED" ? "input"
    : "unknown");
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
  const trainingImageStage = info.code.endsWith("MODEL_INVALID") ? "configuration" as const
    : info.code.includes("_INSPECTION_") ? "inspection" as const
    : info.code.includes("_REGENERATION_") ? "regeneration" as const
    : info.code.includes("_VERIFICATION_") ? "verification" as const
    : "unknown" as const;
  return {
    code: info.code, stage: info.stage, category,
    ...(preparation ? { trainingImageStage } : {}),
    providerHttpStatus: info.httpStatus, providerErrorCode: info.providerCode,
    reasonState: info.reasonState,
    message: preparation ? preparationMessages[info.code]?.[0] ?? "The router could not prepare the training image. No provider creation request was sent. Check the source image and private storage." : framing ? "Tavus rejected the image framing or arm pose. Use a chest-up portrait cropped at or above the navel, with hands at or below chest height. Keep the head and both shoulders visible. Upload a new image version; do not retry the unchanged image." : messages[category][0]!,
    messageKo: preparation ? preparationMessages[info.code]?.[1] ?? "라우터의 학습 이미지 보정·저장에 실패했습니다. 제공자 생성 요청은 전송하지 않았습니다. 원본 이미지와 비공개 저장소를 확인하세요." : framing ? "Tavus가 이미지 구도·팔 자세를 거절했습니다. 배꼽 또는 그 위에서 자른 가슴 위 중심의 상반신 사진을 사용하고, 손·팔은 가슴 높이 이하로 낮추세요. 머리와 양쪽 어깨는 프레임 안에 유지하세요. 같은 이미지로 재시도하지 말고 수정된 새 이미지 버전을 등록하세요." : messages[category][1]!,
    automaticRetryAllowed: false,
    nextAction: unknownCreation ? "operator_reconcile" : aiReview ? "operator_review" : framing || preparation ? "replace_image" : row.providerAvatarId ? "inspect_existing_asset" : "operator_review",
    creationOutcome: row.providerAvatarId ? "created" : unknownCreation ? "unknown" : preparation ? "not_created"
      : info.stage === "create" && info.httpStatus !== null && info.httpStatus >= 400 && info.httpStatus < 500 && info.httpStatus !== 408 ? "not_created" : "unknown",
  };
}
