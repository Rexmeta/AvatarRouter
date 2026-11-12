# RoleplayX 페르소나 라이브 연결 — AvatarRouter API 0.9.1

## 범위와 상태

기존 Base URL + 프로젝트 API 키를 그대로 사용합니다. RoleplayX 로그인·시나리오 선택·대화 엔진·평가 엔진을 교체하지 않습니다.

이번 AvatarRouter 구현은 Tavus의 기존 Stock Face 실행 경로를 프로젝트 소유 Custom Face까지 확장합니다. Anam은 생성 API와 실행 API를 구분하며 커스텀 라이브 실행은 `LIVE_PROVIDER_UNSUPPORTED`로 거절합니다. LemonSlice·Simli 실행 어댑터는 이번 범위가 아닙니다.

코드 및 외부 호출 없는 테스트 완료는 실제 공급자의 재생 성공이 아닙니다. 실제 이미지 전송·생성·라이브 검증은 운영자의 별도 비용 승인 후 진행해야 합니다.

## 페르소나 관리 연동

RoleplayX에는 별도로 `avatarMode: image | video | live`와 라이브 설정 저장 기능이 필요합니다. 기존 이미지·비디오 필드를 재활용하거나 시나리오 관리자에 아바타 설정을 추가하지 않습니다.

1. RoleplayX 서버가 기존 로그인과 관리자/tenant 권한을 검증합니다.
2. 해당 조직의 프로젝트 키로 `GET /api/v1/avatar-assets`를 호출합니다.
3. `status=ready`는 **생성 완료**입니다. `liveValidation.runtimeSupported`는 실행 어댑터 지원 여부입니다.
4. 실제 사용 가능한 라이브 페르소나로 게시하려면 `liveValidation.status=validated`도 확인합니다.
5. 자산의 `id`를 페르소나의 `avatarAssetId`로 저장합니다. 클라이언트가 임의로 보낸 다른 자산 ID를 신뢰하지 않습니다.

Studio 개인 로그인으로 만든 자산은 다른 프로젝트 키에 자동 공유되지 않습니다. 자산 생성·조회·검증·실행은 같은 프로젝트 namespace에서 해야 합니다. 필요할 때만 검증된 사용자 컨텍스트를 사용하고 세션의 모든 호출에서 동일하게 유지합니다.

## 커스텀 아바타의 첫 재생 검증

운영자 승인 전에는 아래 세션 생성·오디오 전송을 실행하지 마세요. 검증도 유료입니다.

### Tavus full 전용 검증 — LiveKit 불필요

`GET /api/v1/auth/check`의 `integration.customValidationPipelines`에
`tavus_full`이 있는지 먼저 확인합니다. 인증 성공이나 계정 요금제만으로 지원을 추정하지 않습니다.
Tavus 서버 키와 실행 Worker는 필요하지만 LiveKit 자격 증명은 필요하지 않습니다.
제공자 잔액·동시 사용 권한은 별도이며, 내부 연결 제한과 cleanup 차단도 그대로 적용됩니다.

키에는 `assets:read`, `assets:write`, `sessions:create`, `sessions:read`,
`sessions:connect`, `sessions:end`가 필요합니다. 이 경로는 `sessions:audio`를 사용하지 않습니다.
동일 tenant의 ready 자산을 조회하고 다음 요청을 **별도 비용 승인 후 한 번만** 보냅니다.

```json
{
  "providerId": "tavus",
  "avatarId": "<asset.providerAvatarId>",
  "avatarAssetId": "<asset.id>",
  "mode": "live",
  "pipeline": "tavus_full",
  "purpose": "validation",
  "costConfirmed": true,
  "fullPipeline": {
    "systemPrompt": "한국어로 짧게 인사하고 사용자의 테스트 질문에 답하세요.",
    "greeting": "안녕하세요. 영상과 제 목소리가 잘 전달되는지 확인해 주세요."
  }
}
```

1. 생성 응답은 접수일 뿐입니다. 조회로 활성·running 상태를 기다립니다.
2. `/sessions/{id}/client-connection`의 공통 descriptor를 기존 AvatarRouter 브라우저
   클라이언트에 전달합니다. 또는 `/full-connection`으로 받은 Daily 연결을 사용합니다.
   제공자 키와 프로젝트 API 키는 브라우저로 보내지 않습니다.
3. Gemini 등 기존 응답 엔진을 동시에 실행하지 않습니다. Tavus full이 대화·음성을 담당합니다.
   `/audio`나 renderer용 PCM 명령은 호출하지 않습니다.
4. 실제 움직이는 원격 영상과 반환 음성을 관측하고, 권한 있는 관리자가 들었음을 확인한 뒤에만
   아래 공통 playback 보고를 보냅니다. 접속·아바타 생성 완료·트랙 존재만으로 자동 보고하지 않습니다.
5. 서버는 같은 tenant·원래 소유자·현재 asset/provider ID·validation 목적·활성 lease와 기한을 확인합니다.
   또한 보존된 대화 ID로 **읽기 전용 GET**을 하여 Tavus가 반환한
   `conversation_id`, `face_id`, `status=active`가 일치하는지 대조합니다.
   GET 실패·불일치·종료 상태는 `LIVE_VALIDATION_PROVIDER_EVIDENCE_REQUIRED`로 거절합니다.
   유료 생성 요청을 재시도하지 않습니다.
6. 검증 저장 후에도 세션을 종료하고 cleanup 완료를 확인합니다. 종료 접수만으로 차단을 해제하지 않습니다.

API 보고 형식은 아래 renderer 경로와 동일합니다. 이 기록은 서버의 독립적인 청취 증명이 아니라
**권한 있는 클라이언트의 관측 진술 + 실제 제공자 대상 확인**입니다.
Playground에서 ready Tavus 자산을 선택하면 전용 full 검증 패널을 사용할 수 있습니다.
운영 적용 및 실제 통화 검증은 별도입니다.

### 기존 외부 오디오 Renderer 검증 — 보존

키에는 `assets:read`, `assets:write`, `sessions:create`, `sessions:read`, `sessions:connect`, `sessions:audio`, `sessions:end`가 필요합니다.

`GET /api/v1/avatar-assets/{id}`로 소유권과 현재 Provider ID를 조회한 뒤:

```json
{
  "providerId": "tavus",
  "avatarId": "<asset.providerAvatarId>",
  "avatarAssetId": "<asset.id>",
  "mode": "live",
  "purpose": "validation",
  "costConfirmed": true
}
```

위 본문을 `POST /api/v1/sessions`에 보냅니다. HTTP 201은 대기열 등록이며 영상 준비 완료가 아닙니다. 동일 자산을 재학습하지 않습니다.

1. 반환된 세션 ID로 조회하여 `rendererState=running`을 기다립니다.
2. `/sessions/{id}/connection`의 임시 구독 전용 토큰으로 LiveKit에 연결합니다.
3. 실제 원격 영상 프레임이 재생되는지 확인합니다. 참가자 접속이나 정지 이미지 표시만으로 성공 처리하지 않습니다.
4. `/sessions/{id}/audio`로 24 kHz mono PCM16 LE를 전송합니다(요청당 20 ms–5 s). 명령 완료와 실제 반환 소리를 확인합니다.
5. 같은 세션 소유자 컨텍스트로 아래 보고를 전송합니다.

`POST /api/v1/avatar-assets/{assetId}/live-validation`:

```json
{
  "sessionId": "<validation-session-id>",
  "videoObserved": true,
  "audioObserved": true
}
```

서버는 자산·프로젝트·세션 소유자·Provider ID 일치, 세션 purpose, 실행/유효기간/lease, Provider 생성 ID, 오디오 명령 완료를 검사합니다. 이후 `liveValidation.status=validated`, `method=client_playback_report`와 세션 ID·확인 시각을 저장합니다.

이 보고는 **권한 있는 클라이언트/운영자의 재생 확인 진술**입니다. 서버가 브라우저 화면이나 사람이 실제로 들었는지를 독립적으로 증명하지는 않습니다. RoleplayX 서버는 사용자가 임의로 성공 플래그를 보내 등록할 수 없도록 관리자 권한을 검사해야 합니다.

마지막으로 반드시 `/sessions/{id}/end`를 호출하고 상태를 조회하여 원격 정리 완료를 확인합니다. 정리 불명확 상태에서는 재생성을 시도하지 않습니다.

## 검증 이후 일반 대화

동일한 세션 생성 본문에서 `purpose`를 `conversation`으로 바꾸거나 생략합니다. 서버는 현재 Provider avatar ID에 대한 검증 기록이 없으면 `LIVE_VALIDATION_REQUIRED`로 차단합니다. ID가 변경되거나 자산이 준비 상태가 아니면 이전 검증을 재사용하지 않습니다.

매 대화마다 새 세션을 생성하되 기존 자산을 재학습하지 않습니다.
`external_audio`에서는 기존 RoleplayX AI 출력 음성을 AvatarRouter에 전달하고 원래 음성 플레이어와 중복 재생하지 않도록 조정합니다.
`tavus_full`은 명시적인 대체 엔진으로 선택하며 Gemini 음성·응답과 동시에 실행하지 않습니다.
full 검증을 완료했다고 기존 페르소나의 대화 엔진 설정이 자동 변경되지는 않습니다.
브라우저에 프로젝트 API 키를 전달하지 않습니다.

Tavus의 회당 기한은 `TAVUS_LIVE_SESSION_SECONDS`로 설정하며 Stock/Custom, full/renderer에 동일하게 적용됩니다.
`LIVE_USER_DAILY_SECONDS`는 프로젝트별 하루 예약 시간, `LIVE_GLOBAL_DAILY_SECONDS`는 서비스 전체 하루 예약 시간입니다.
현재 운영자 승인값은 각각 600/3600/7200초입니다. 설정·소스가 게시된 뒤에만 운영 반영됩니다.
클라이언트는 `/live-limits.sessionSeconds`와 세션 `expiresAt`을 사용하고 자체 120초 타이머를 추가하지 않습니다.
호스팅 브라우저 SDK 0.9.2의 `server_deadline_v1` 기능을 확인하세요.
RoleplayX가 이미 로드한 구버전 SDK를 계속 재사용하면 게시 후에도 예전 120초 타이머가 남을 수 있으므로,
페이지를 다시 로드하여 새 SDK를 받아야 합니다. 재로드 자체가 새 유료 세션을 생성해서는 안 됩니다.
제공자 제한은 더 짧을 수 있으며, 실제 사용 시간보다 예약 시간이 먼저 차감됩니다. 실패한 시도의 기존 예약도 임의로 지우지 않습니다.
Anam의 별도 120초 정책은 이번 Tavus 설정 변경 대상이 아닙니다.
프로젝트/전체 예산·동시 실행 제한·작업자 lease·불명확 생성 격리·종료 재시도는 Stock과 Custom에 동일하게 적용됩니다.
사용 중이거나 원격 정리가 미확정인 자산은 삭제할 수 없습니다. 이 시간 예산은 공급자 크레딧 잔액이 아닙니다.

## 주요 오류

| 코드 | 조치 |
| --- | --- |
| LIVE_COST_CONFIRMATION_REQUIRED | 운영자가 유료 사용을 승인한 뒤에만 재요청 |
| LIVE_VALIDATION_REQUIRED | 먼저 별도의 검증 세션에서 실제 재생 확인 |
| LIVE_PROVIDER_UNSUPPORTED | 미지원 어댑터; 다른 Provider로 조용히 대체하지 않음 |
| LIVE_WORKER_UNAVAILABLE | 작업자 복구 전 유료 생성 차단 |
| LIVE_VALIDATION_AUDIO_REQUIRED | 연결만으로 부족; 오디오 명령 완료와 실제 소리 확인 필요 |
| LIVE_VALIDATION_PROVIDER_EVIDENCE_REQUIRED | full 세션의 실제 대화/face/활성 상태 확인 실패; 상태만 확인하고 자동 생성 재시도 금지 |
| LIVE_VALIDATION_SESSION_INVALID | 자산/세션/소유자/목적/유효기간 일치 확인 |
| AVATAR_ASSET_IN_USE | 세션 종료와 원격 정리 확인 후 삭제 |
| CONSENT_REVIEW_REQUIRED | 실제 인물의 동의 및 공급자 요건을 독립 검토 |

유료 생성·오디오 명령의 타임아웃을 자동 재전송하지 않습니다. 연결 확인 `/auth/check`에는 이 검증/과금 경로를 사용하지 않습니다.
