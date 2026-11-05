# RoleplayX → AvatarRouter: Tavus full pipeline (API 0.6)

## 두 모드의 차이

| pipeline | 대화 / 음성 생성 | 브라우저 연결 |
|---|---|---|
| external_audio (기본값, 기존 동작 유지) | RoleplayX Gemini Live | AvatarRouter LiveKit, Gemini PCM을 /audio로 전송 |
| tavus_full (명시적 선택) | Tavus STT + LLM + TTS + 아바타 | Tavus private Daily room, 사용자 마이크를 Daily로 직접 전송 |

`tavus_full`에서 Gemini Live 대화/음성 생성과 Gemini 마이크 전송을 동시에 실행하지 마세요.
Gemini를 계속 쓰는 기존 페르소나는 `external_audio`로 유지하세요.
이 구현은 AvatarRouter의 API와 워커를 확장합니다. RoleplayX 자체의 모드 선택 UI,
Daily SDK, 대화 기록/평가 연결은 RoleplayX 측에서 아래 계약에 맞게 적용해야 합니다.

## 1. 무료 사전 확인

서버에서 기존 Base URL + 프로젝트 API 키로 `GET /auth/check`를 호출합니다.
`integration.features`에 `tavus_full_pipeline`, `daily_private_connection`이 있는지 확인하세요.
구버전 운영 서버에 배포되지 않았다면 기능이 없다고 표시하고 생성하지 마세요.
`GET /live-limits`에서 생성 가능 여부, 워커, 예산, cleanupPending을 확인하세요.
기능 표시는 구현 유무이지 실제 재생 성공이나 요금제 보장이 아닙니다.

필요 권한: `sessions:create`, `sessions:read`, `sessions:connect`, `sessions:end`.
커스텀 아바타 조회에는 `assets:read`도 필요합니다.
로그인 검증 및 관리자/페르소나 권한은 기존 RoleplayX 서버에서 유지합니다.
API 키는 서버에만 보관하고, 기존과 동일한 검증된 사용자 컨텍스트를 매 요청에 전달하세요.

아래 URL은 Base URL(`/api/v1`) 기준 상대 경로입니다.

## 2. 생성

사용자의 시작 동작과 비용 동의 후 서버에서 `POST /sessions`:

```json
{
  "providerId": "tavus",
  "avatarId": "tavus-stock-lucy",
  "mode": "live",
  "pipeline": "tavus_full",
  "costConfirmed": true,
  "fullPipeline": {
    "systemPrompt": "You are a Korean-speaking customer in a sales roleplay. Stay in character.",
    "context": "학습자는 영업 담당자입니다. 예산 문제를 제기하고 구체적인 설명을 요청하세요.",
    "greeting": "안녕하세요. 제품에 관해 몇 가지 질문이 있습니다.",
    "languages": ["ko"]
  }
}
```

`fullPipeline.voiceId`에 Tavus-managed voice ID를 선택적으로 지정할 수 있습니다.
생략하면 Tavus/Face 기본 음성을 사용합니다. 외부 TTS API 키, 임의 PAL ID,
LLM 키 또는 제공자 서명 비밀을 클라이언트에서 받거나 공유하지 않습니다.
Tavus가 거절한 언어/음성은 오류로 반환하며 다른 음성으로 조용히 바꾸지 않습니다.

각 세션에 별도 `pipeline_mode=full` PAL을 만들어 프로젝트 간 프롬프트/음성을 공유하지 않습니다.
커스텀 아바타는 기존 `avatarAssetId`와 해당 asset의 provider/아바타 ID를 함께 지정합니다.
준비 완료, 동의, 재생 검증 정책은 기존과 동일합니다. full pipeline은 validation 용도가 아닙니다.
최대 120초, 기존 일일 예산·동시 실행 제한·정리 차단이 동일하게 적용됩니다.
세션 생성은 비멱등 유료 작업입니다. 타임아웃 시 자동 POST 재시도를 하지 마세요.

## 3. 준비 상태와 브라우저 접속

생성 응답의 `id`로 `GET /sessions/{id}`를 주기적으로 확인하세요.
`status=active`, `rendererState=running`, `stopRequested=false`일 때만
서버에서 `GET /sessions/{id}/full-connection`을 호출하세요.
실패/만료/종료 요청이 있으면 폴링을 중단하고 정리 상태를 표시하세요.

```json
{
  "transport": "daily",
  "pipeline": "tavus_full",
  "url": "https://your-room.tavus.daily.co/room",
  "token": "<private short-lived meeting token>",
  "expiresAt": "<ISO session deadline>"
}
```

이 응답은 해당 세션 소유자에게만 전달합니다. 로그·분석 이벤트·localStorage에 저장하지 마세요.
`/connection`은 기존 LiveKit 전용입니다. full pipeline을 그 모듈로 연결하면 안 됩니다.

RoleplayX 브라우저에서 `@daily-co/daily-js`의 call object를 사용합니다:

```javascript
const call = DailyIframe.createCallObject();
// track-started: 원격 참가자의 video/audio track을 각각 화면과 오디오 요소에 연결.
// participant-updated / track-stopped / left-meeting / error 처리도 등록하세요.
// 이 API 응답만으로 재생 성공 처리하지 말고 실제 미디어 상태를 확인하세요.
await call.join({
  url: connection.url,
  token: connection.token,
  audioSource: true,
  videoSource: false
});
// 사용자 카메라가 필요한 시나리오만 별도 카메라 동의 후 videoSource를 활성화합니다.
```

브라우저의 안전한 HTTPS 환경, 마이크 권한과 사용자 동작을 통한 오디오 재생 허용이 필요합니다.
Gemini 마이크 캡처/응답 재생을 먼저 중지하고 Daily에 마이크를 한 번만 전송하세요.
Tavus의 동일 연결에서 수신한 영상과 음성을 함께 재생해야 합니다.
일반 끼어들기는 Tavus full pipeline의 턴 처리에 맡기세요.
`/audio`, `/interrupt`는 full pipeline에서 409 `FULL_PIPELINE_DIRECT_MEDIA`를 반환합니다.
`/end`를 일반 끼어들기에 사용하지 마세요.

## 4. 종료 / 장애

사용자 종료 또는 화면 이탈 시 RoleplayX 서버가 `POST /sessions/{id}/end`를 호출하고
브라우저는 `await call.leave(); await call.destroy();`로 로컬 미디어를 정리합니다.
중복 서버/브라우저 종료 호출을 피하도록 서버를 종료 소유자로 두세요.
종료 접수는 원격 종료 확인이 아닙니다. 세션 상태의 `cleanupPending=false`,
`rendererState=closed`를 확인하세요. 세션 만료 시 워커도 종료를 수행합니다.
워커는 Tavus 대화 종료 후 이 세션에서 생성한 PAL도 삭제합니다.
생성 결과 불명, 종료 확인 불가 상태는 기존 운영자 조정 절차를 유지합니다.

오류 코드:
- `INVALID_PIPELINE_CONFIG`: 모드/입력 조합 오류
- `TAVUS_FULL_PAL_REJECTED`: 프롬프트/언어/음성 설정이 Tavus에서 거절됨
- `TAVUS_FULL_CREATE_FAILED`: Tavus 생성 미확인, 자동 재시도 금지
- `LIVE_CREATE_RECONCILIATION_REQUIRED`: 생성 결과 불명, 기존 안전 차단
- `FULL_PIPELINE_DAILY_REQUIRED`: 잘못된 LiveKit 연결 경로
- `FULL_PIPELINE_DIRECT_MEDIA`: Gemini PCM/기존 interrupt 경로 사용 금지

Tavus가 대화 엔진이므로 기존 Gemini 실시간 이벤트/대화 기록이 자동 생성되지는 않습니다.
평가를 유지하려면 Tavus/Daily transcript 이벤트를 RoleplayX의 기존 대화 기록 형식으로
변환해야 합니다. 이 API 추가만으로 평가/자막 연동 완료라고 표시하지 마세요.
Tavus 전용 transcript나 webhook의 원문/서명 검증 없이 외부 콜백을 신뢰하면 안 됩니다.

### 확정 대화록 확장

`GET /auth/check`의 `integration.features`에 `tavus_final_transcript_v1`이
광고된 서버만 `GET /sessions/{id}/transcript`를 지원합니다.
권한은 `sessions:read`이며 owner와 tenant를 모두 검사합니다.
응답은 `Cache-Control: private, no-store`입니다.

- `status: pending`: 대화 종료·정리 또는 제공자 확정 대화록을 기다립니다.
- `status: unavailable`: 제공자 대화가 없거나 조회할 수 있는 기록이 없습니다.
- `status: ready`: `final: true`, `sessionId`, `source: tavus`,
  `messages: [{ role: user|assistant, text, timestamp: ISO8601 }]`,
  `revision: SHA256(JSON.stringify(messages))`를 반환합니다.

라우터 서버가 기존 Tavus 인증으로 `GET /v2/conversations/{id}?verbose=true`를
조회하여 `status: ended`와 `application.transcription_ready`를 함께 확인합니다.
system/tool 내용, 제공자 conversation ID, PAL, 방 주소·토큰은 반환하지 않습니다.
Daily의 실시간 app-message나 전체 LLM 응답은 평가용 확정 기록으로 승격하지 않습니다.
제공자 확정 대화록은 독립적인 음성 인식 정확성이나 실제 재생 인증을 뜻하지 않습니다.

RoleplayX는 동일 revision을 멱등 import하고 기존 대화 원장/기록과 피드백
작업 큐에 연결해야 합니다. 기능 광고가 없는 구버전 라우터에서는 해당 API를
호출하거나 평가 완료를 표시하지 마세요. 새 코드 검토·배포 뒤에 기능이 활성화됩니다.

## 검증 범위

외부 서비스 호출 없는 자동 테스트와 타입 검사를 제공합니다.
실제 Tavus 유료 생성, RoleplayX 브라우저 마이크/영상/음성 재생,
언어별 음성 품질과 평가 연동은 별도의 승인된 실제 테스트가 필요합니다.

## 운영 반영 순서

개발 환경에는 추가 컬럼 마이그레이션을 적용했습니다. 운영 DB는 이번 작업에서 변경하지 않았습니다.
운영 코드/워커를 시작하기 전에 기존 배포 DB 마이그레이션 절차로
`scripts/sql/renderer-ownership.sql`의 추가 컬럼(`pipeline`, `full_pipeline`)을 반영해야 합니다.
기존 컬럼·키·세션을 삭제하거나 불확실한 세션 차단을 해제하지 않습니다.
그다음 새 API/워커를 게시하고 `/auth/check` 기능 표시를 확인한 후 RoleplayX를 연결하세요.

공식 참고:
- https://docs.tavus.io/api-reference/pals/create-pal
- https://docs.tavus.io/api-reference/conversations/create-conversation
- https://docs.tavus.io/sections/conversational-video-interface/pal/tts
- https://docs.daily.co/reference/daily-js/instance-methods/join
