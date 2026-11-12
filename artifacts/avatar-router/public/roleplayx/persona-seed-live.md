# RoleplayX 페르소나 수정: 시드 이미지 → 라이브 아바타

> 최신 자동 처리: 원본 보존 → 리사이즈 → Gemini 조건 검사 → 필요 시 원본 기반 재생성 → 재검사 → 제공자 전송. 별도 라우터 운영자 승인 대기는 없습니다. 비용·권한·오류·재시도 정책은 `automatic-training-images.md`를 참조하세요. 기본 업로드 검증을 통과한 작은 원본도 학습 사본을 보정합니다.

## 기본 이미지·학습 보정·이름 전달

RoleplayX는 페르소나의 기존 기본 이미지를 그대로 전송합니다. 클라이언트에서
수동 크롭·제공자별 변환을 필수로 요구하지 않습니다. AvatarRouter는 기존 저장
정규화를 유지하고, Tavus 생성 요청에 `auto_fix_training_image: true`를 설정하여
**Tavus AI Image Fixer**가 학습용 이미지를 보정하도록 요청합니다.
원본 페르소나 이미지·원본 자산은 덮어쓰지 않습니다.
별도의 로컬 AI 이미지 편집기나 보정 결과 다운로드 기능을 추가한 것은 아닙니다.
이 기본 보정은 새 생성 요청에만 적용되며, 실패한 기존 자산을 자동 재제출하지 않습니다.
권한·동의·연령·저작권 제한은 그대로이며 모든 이미지가 보정되는 것은 아닙니다.

### 생성 이름 = 페르소나 ID

이미지 등록 후 다음 요청을 RoleplayX 서버에서 보냅니다:

```json
{
  "imageAssetId": "<등록 응답의 이미지 UUID>",
  "providerId": "tavus",
  "personaId": "persona_123",
  "voiceName": "anna",
  "costConfirmed": true
}
```

`POST /api/v1/avatar-assets`의 `personaId`가 자산 이름과 제공자의 `face_name`이 됩니다.
영문·숫자로 시작하는 최대 128자 ID이며 영문·숫자·`. _ : -`만 허용합니다.
표시 이름이나 시나리오 이름을 이 필드에 넣지 마세요.
기존 클라이언트는 생략할 수 있으며 이 경우 종전 이미지 이름이 유지됩니다.
같은 이미지·제공자·음성에 이미 다른 이름의 자산이 있다면
`AVATAR_ASSET_PERSONA_CONFLICT`로 거절합니다. 묵시적 이름 변경·중복 유료 생성을 하지 않습니다.

### 대화 이름 = 시나리오 배정 이름

역할·시나리오 컨텍스트는 기존대로 전송하면서 세션 생성 요청에
`scenarioAssignmentName`을 추가합니다:

```json
{
  "providerId": "tavus",
  "avatarId": "<검증된 제공자 얼굴 ID>",
  "avatarAssetId": "<검증된 자산 UUID>",
  "mode": "live",
  "costConfirmed": true,
  "scenarioAssignmentName": "신입 관리자 고객 상담 실습 1차",
  "roleplay": {
    "persona": "<권한 검증된 페르소나 특성>",
    "scenario": "<권한 검증된 시나리오 컨텍스트>"
  }
}
```

Tavus full 모드의 `conversation_name`에 **전달한 배정 이름 그대로** 적용합니다.
한글을 지원하고 최대 200자이며 빈 이름·제어문자를 거절합니다.
Tavus full 외 경로에는 이 필드를 보내지 않습니다. 생략한 구버전 요청은
종전 내부 세션 이름을 사용합니다. 내부 세션 UUID·PAL 이름·제공자 ID와
프로젝트 소유권은 별도로 유지되며, 중복 가능한 표시 이름으로 자원을
찾아 종료하거나 권한을 판단하지 않습니다.

RoleplayX 서버가 두 새 필드를 실제로 전송하도록 수정해야 합니다.
AvatarRouter가 외부 DB의 페르소나 ID나 배정 이름을 추측하지 않습니다.

## 생성 실패를 표시하는 계약

AvatarRouter의 `POST /api/v1/avatar-assets`는 **HTTP 202 접수**이며 생성 성공이 아닙니다.
RoleplayX 서버는 반환된 자산 ID를 저장하고 같은 프로젝트 키로
`GET /api/v1/avatar-assets/{id}`를 약 4초 간격으로 조회하세요.
`queued/submitting/processing`에서는 “생성 중”으로 표시하고, `ready`에서만 생성 완료로 표시합니다.
이후 별도의 실제 재생 검증이 있어야 라이브 모드 활성화가 가능합니다.

실패 시 `errorCode`는 기존의 안정적인 오류 코드를 유지하며, 새 `failure`가
실패 단계와 공개 가능한 증거를 제공합니다. 같은 정보가 시드 이미지
`live-options.candidates[].failure`에도 포함됩니다.

```json
{
  "status": "failed",
  "errorCode": "PROVIDER_TRAINING_FAILED",
  "failure": {
    "code": "PROVIDER_TRAINING_FAILED",
    "stage": "status",
    "category": "training",
    "providerHttpStatus": 200,
    "providerErrorCode": null,
    "reasonState": "unrecognized_reason",
    "message": "The provider created a face reference but reported training failure. This does not establish a billing or plan problem.",
    "messageKo": "제공자가 얼굴 참조를 발급했지만 학습 실패를 반환했습니다. 이 결과만으로 비용·요금제 문제라고 판단할 수 없습니다.",
    "automaticRetryAllowed": false,
    "nextAction": "inspect_existing_asset",
    "creationOutcome": "created"
  }
}
```

위는 **신규 진단의 예시**이며 과거 실패에서 HTTP 200을 보존했다는 뜻은 아닙니다.
과거 기록에는 `stage=unknown`, `providerHttpStatus=null`, `reasonState=not_retained`가
반환될 수 있습니다. `created`는 제공자 참조가 발급됐다는 뜻이지 학습 성공이 아닙니다.
학습 단계는 HTTP 200이어도 본문의 `status=error`로 실패할 수 있습니다.

외부 앱 처리 규칙:
- HTTP 202를 “완료”로 표시하지 말고 “요청 접수·생성 중”으로 표시합니다.
- `failed`/`reconciliation_required`에서 폴링을 멈추고 `failure.messageKo`와 자산 ID,
  실패 단계, 존재하는 HTTP 상태·제공자 코드만 표시합니다.
- `failure`가 없는 구버전 서버는 `errorCode`를 표시하고 “상세 원인 미보존”으로 안내합니다.
- 종료·편집기 닫기·새로고침 때 오류를 지우지 않습니다. 저장된 자산 ID로 상태를 다시 조회합니다.
- 기존 이미지를 유지하되 라이브 설정 성공으로 저장하지 않습니다. 기존 정상 라이브 연결을
  보존하려면 새 생성 후보와 활성 연결을 별도 필드로 관리합니다.
- 실패 버튼으로 같은 `POST`를 반복하지 않습니다. 기존 자산 결과 확인은 GET만 사용합니다.
- `creationOutcome=unknown` 또는 `nextAction=operator_reconcile`이면 운영자 확인 전
  재생성·삭제·차단 우회를 제공하지 않습니다.
- API 실패(권한·동의·이미지 규격 등)는 HTTP 오류 응답의 `error`/`message`를 별도로 표시합니다.
- 저장·프록시 응답 스키마에서 `failure`를 제거하지 마세요. 앱 화면도 이를 명시적으로 소비해야 합니다.

`providerHttpStatus`는 제공자의 응답이며 RoleplayX→AvatarRouter HTTP 상태가 아닙니다.
임의의 제공자 본문·`error_message`·서명 URL은 반환하지 않습니다. 알려진 코드만 보존하며,
낯선 문구는 `unrecognized_reason`으로 표시합니다. 비용 문제로 추정 변환하지 않습니다.

### Phoenix-4.5 이미지 구도 거절

이번에 확인된 Tavus 문구(배꼽 아래·전신·높이 든 팔 제한)는 검토된 고정 문구일 때만
`failure.providerErrorCode=training_image_framing_invalid`, `category=input`,
`nextAction=replace_image`로 전달합니다. 임의 문장에서 단어만 추출해 추정하지 않습니다.
RoleplayX는 `messageKo`를 보여 주고 이미지 수정·새 버전 업로드로 안내하세요.
과거 저장된 `PROVIDER_TRAINING_FAILED`에 이 코드를 추정해 소급 적용하지 않습니다.

생성 버튼 앞에 다음 기준을 표시하세요:
- 성인 한 명, 최소 512×512 JPG/PNG(라우터는 저장 시 JPEG로 정규화).
- 가슴 위 중심 상반신 구도 권장, 머리와 양쪽 어깨가 프레임 안에 있어야 합니다.
- 배꼽 또는 그 위에서 자르며 전신·하복부가 넓게 드러난 구도는 피합니다.
- 손·팔은 가슴 높이 이하로 낮추고 얼굴을 가리지 않습니다.
- 픽셀 크기는 서버에서 검사하지만 구도·자세 적합성은 보장하지 않습니다.

같은 실패 이미지의 POST를 반복하지 마세요. 새 요청에는 위의 명시된 Tavus
AI Image Fixer가 적용됩니다. 그래도 거절되면 사용자가 구도를 수정한 뒤
`previousVersionId`로 새 시드를 등록하세요. 새 유료 생성 동의는 여전히 필요합니다.
기존 실패 자산의 제공자 ID는 삭제하거나 덮어쓰지 않습니다.

이미지로 학습하는 현재 경로의 직접 기준:
https://docs.tavus.io/sections/faces/phoenix-45-image-requirements
동영상 학습 기준과 혼동하지 마세요.

## 구현 범위

AvatarRouter API·관리 화면의 계약입니다. 외부 RoleplayX 저장소의 실제 편집기나
DB를 이 문서가 자동 변경하지 않습니다. 아래 편집·저장 처리를 RoleplayX에 적용하세요.
기존 로그인, 관리자/tenant 권한, 페르소나 이미지·비디오, 시나리오 선택과 평가를 유지합니다.
라이브 설정 위치는 **페르소나 관리 → 수정**이며 시나리오 관리에 추가하지 않습니다.

## 편집 화면의 구성

1. 표시 방식: 기존 `image`, `video`와 별도의 `live`. 기본값은 기존 값을 유지합니다.
2. 현재 시드 이미지: 변경할 때 이전 라이브 연결을 해제하고 신규 이미지를 확인합니다.
3. 라이브 얼굴: 같은 프로젝트·같은 시드 버전에서 만든 Tavus 자산만 선택합니다.
4. 상태/다음 조치: 생성 대기, 처리 중, 실패, 생성 결과 확인 필요, 재생 검증 필요,
   선택 가능, 실존 인물 동의 검토를 구분해서 표시합니다.
5. 비용이 드는 `얼굴 생성`과 `테스트 시작`은 저장과 분리한 명시적 동작입니다.
   편집기를 열거나 저장하거나 시드 이미지를 바꾸는 것만으로 생성하지 않습니다.
6. 생성·검증 중에도 일반 페르소나 수정은 초안으로 저장할 수 있지만,
   검증되지 않은 라이브 모드를 학습자에게 활성화하지 않습니다.

## 1. 기존 시드를 Router 이미지로 등록

RoleplayX 서버가 기존 저장소에서 해당 tenant의 이미지 읽기 권한을 확인하고
같은 프로젝트 API 키로 `POST /assets/images`를 호출합니다(Base URL은 `/api/v1`).

```json
{
  "name": "페르소나 이름 - 시드",
  "imageBase64": "<권한 확인한 이미지의 순수 base64>",
  "rightsConfirmed": true,
  "likeness": "synthetic"
}
```

사용자 권리 확인 없이 `rightsConfirmed`를 자동으로 true로 설정하지 마세요.
실존 인물이면 `likeness=real_person`, 실제 증빙의 `consentReference`가 필요하며,
운영자의 독립 검토가 끝나기 전 제공자 전송이 차단됩니다.
서명 URL·대화·이미지 본문·비밀키를 로그에 남기지 마세요.
`sourceUrl`을 쓰려면 서버 허용 목록과 권한 검증을 모두 충족해야 합니다.
URL이 거절됐다고 임의 프록시나 무제한 외부 다운로드로 우회하지 마세요.

반환된 이미지 `id`, `version`을 페르소나 초안에 저장합니다.
이미지가 변경되면 이전 ID를 계속 쓰지 말고 `previousVersionId`를 포함해 등록한
새 이미지의 ID로 교체합니다. 동일 프로젝트·동일 이미지의 기존 자산은 재사용합니다.

## 2. 시드별 상태 조회: 새 읽기 전용 API

`GET /auth/check`의 `integration.features`에서 `seed_image_live_options`를 확인하고:

```text
GET /assets/images/{imageAssetId}/live-options
Authorization: Bearer <AvatarRouter project key>
```

권한은 `assets:read`. 해당 프로젝트의 이미지가 아니면 404입니다.
이미지 전송, 제공자 조회, 얼굴 생성, 통화 생성, 데이터 변경을 하지 않습니다.

```json
{
  "imageAssetId": "<현재 시드 이미지 ID>",
  "imageVersion": 2,
  "providerId": "tavus",
  "canProvision": false,
  "nextAction": "validate",
  "candidates": [{
    "avatarAssetId": "<소유 자산 ID>",
    "status": "ready",
    "canActivate": false,
    "nextAction": "validate",
    "liveReference": null
  }]
}
```

`canProvision`은 로컬 선행 조건이지 플랜 잔액이나 생성 승인 증명이 아닙니다.
후보가 있으면 새 생성보다 기존 자산의 상태 확인·검증·재사용을 우선합니다.
`reconcile`이면 자동 생성 재시도를 금지합니다.
`replace_image`는 이 참조를 활성화할 수 없다는 뜻입니다. 삭제 중인 자산의 정리를
확인하기 전에 우회 생성하지 마세요.

## 3. 얼굴 생성과 재생 검증

별도 비용 동의 후 기존 `POST /avatar-assets`:

```json
{
  "imageAssetId": "<현재 시드 이미지 ID>",
  "providerId": "tavus",
  "voiceName": "anna",
  "costConfirmed": true
}
```

`voiceName`은 이미지 학습에 쓰는 Tavus 얼굴 음성 이름입니다.
full pipeline 대화의 `fullPipeline.voiceId`와 같은 필드가 아닙니다.
실제 허용된 음성 및 이미지 요건은 제공자가 최종 판단합니다.
공식 문서: https://docs.tavus.io/sections/faces/image-to-face-quickstart

AvatarRouter가 비공개 이미지의 제한된 다운로드 URL 생성과 Tavus 전송을 담당합니다.
얼굴 생성은 유료일 수 있으며 이미지 업로드나 구독 업그레이드만으로 승인되지 않습니다.
202 응답 뒤 동일 asset을 조회하며 상태를 기다립니다. POST를 자동 반복하지 않습니다.
Phoenix-4.5의 `completed`가 워터마크 있는 초기 결과일 수도 있습니다.

`ready`이면 아직 라이브 사용 확정이 아닙니다. 기존
[페르소나 라이브 검증](persona-live-integration.md) 절차로 실제 영상·음성을 확인하세요.
현재 커스텀 재생 검증 경로는 LiveKit renderer를 사용하므로 서버 LiveKit 설정이 필요합니다.
검증을 마친 후 대화의 `tavus_full` 경로는 Daily를 사용합니다.
서버가 생성 완료만 보고 재생 성공을 자동 기록해서는 안 됩니다.

## 4. 저장 시 최신 상태·시드 연결을 재검증

RoleplayX 서버가 저장 권한을 다시 검사하고, 현재 시드 ID의 `live-options`를 새로 조회합니다.
선택한 `avatarAssetId`와 일치하는 후보가 `canActivate=true`인지 확인하고 서버가 반환한
`liveReference`만 저장합니다. 클라이언트의 임의 provider/avatar ID를 신뢰하지 마세요.

아래는 **저장 구조 예시**이며 RoleplayX의 실제 스키마 이름에 맞춰 적용해야 합니다:

```json
{
  "avatarMode": "live",
  "seedImageAssetId": "<현재 시드 이미지 ID>",
  "liveAvatar": {
    "providerId": "tavus",
    "avatarId": "<서버가 확인한 provider face ID>",
    "avatarAssetId": "<서버가 확인한 자산 ID>",
    "pipeline": "tavus_full"
  }
}
```

시드 교체·자산 삭제·만료·제공자 ID 변경·검증 무효화가 생기면 활성화할 수 없습니다.
편집 중 시드를 A→B로 변경했을 때 뒤늦게 도착한 A의 조회 응답을 B에 적용하지 마세요.
조회 캐시는 사용자·프로젝트·시드 ID별로 분리하고 계정 전환 때 해제합니다.
원래 시드 이미지는 로딩·오류 화면의 이미지로 유지하되 라이브 성공으로 표시하지 않습니다.

## 5. 실제 시나리오 대화

저장된 참조를 다시 소유권 확인하고 기존 `POST /sessions`에 아래처럼 전달합니다:

```json
{
  "providerId": "tavus",
  "avatarId": "<liveAvatar.avatarId>",
  "avatarAssetId": "<liveAvatar.avatarAssetId>",
  "mode": "live",
  "costConfirmed": true,
  "roleplay": {
    "persona": "<권한 확인된 페르소나 특성>",
    "scenario": "<현재 시나리오와 대화 컨텍스트>",
    "language": "Korean"
  }
}
```

`roleplay`가 있으므로 `pipeline`을 생략하면 Router가 `tavus_full`을 선택합니다.
Gemini Live가 응답과 마이크를 동시에 처리하지 않도록 대화 엔진을 명시적으로 전환하세요.
기존 Gemini 음성을 유지하는 페르소나는 `external_audio`로 유지하고 그 기존 계약을 따릅니다.
full pipeline에서는 같은 Tavus 연결의 영상·음성을 함께 재생합니다.
실제 생성/재생/정리 실패를 구분하고 자동 유료 재시도를 하지 않습니다.
