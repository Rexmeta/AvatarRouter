# RoleplayX 페르소나 수정: 시드 이미지 → 라이브 아바타

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
