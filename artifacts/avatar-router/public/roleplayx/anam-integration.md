# AvatarRouter → Anam 저장 페르소나 연동 · API 0.7

> 새 RoleplayX 연동의 권장 경로는 API 0.8의 `managed-client-integration.md`입니다.
> RoleplayX에서 Anam SDK를 설치하지 않고 AvatarRouter 공통 클라이언트를 사용합니다.
> 아래 제공자별 SDK 절차는 저수준 어댑터 설명 및 기존 클라이언트 호환용입니다.

## 범위

AvatarRouter 프로젝트 API 키로 Anam 저장 페르소나를 사용할 수 있습니다.
Anam API 키는 AvatarRouter 서버에만 둡니다. RoleplayX의 기존 로그인은 변경하지 않습니다.
현재 등록된 카탈로그 항목은 `anam-persona-default`이며, Anam의
`c00f2c0c-b16b-49f3-9f07-672162b2741c` 페르소나를 참조합니다.
이 항목은 커스텀 아바타 자산 UUID가 아닙니다.

이 경로는 Anam의 대화·음성을 사용하는 `anam_full` 모드입니다.
Gemini Live와 마이크 입력·응답 생성을 동시에 실행하지 마세요.
기존 Gemini PCM을 Anam으로 보내는 렌더링 전용 기능은 이번 범위에 포함하지 않습니다.
프롬프트·음성·모델은 저장 페르소나 설정을 사용하며 임의로 공용 페르소나를 수정하지 않습니다.

## 사전 확인

- AvatarRouter `GET /auth/check`를 확인합니다.
  응답의 `integration.features`에 `anam_full_pipeline`, `anam_single_start_connection`이 있어야 합니다.
- `/avatars`에서 `providerId=anam`, `id=anam-persona-default`를 찾습니다.
- `/live-limits?providerId=anam`의 `creationAllowed`, `blockingReasons`를 확인합니다.
  인증 성공이나 토큰 발급은 영상 재생 성공을 의미하지 않습니다.
- AvatarRouter 서버의 `ANAM_API_KEY`는 해당 페르소나의 토큰 발급,
  세션 목록/상태 읽기와 세션 종료 권한이 필요합니다.
  네이티브 경로에는 LiveKit 키나 `ANAM_AVATAR_ID`가 필요하지 않습니다.
- 프로젝트 키에는 `sessions:create`, `sessions:read`, `sessions:connect`,
  `sessions:end`, `live-limits:read` 권한이 필요합니다.

아래 경로는 설정된 AvatarRouter Base URL(예: `/api/v1`)을 기준으로 합니다.
프로젝트 API 키를 사용하는 호출은 반드시 RoleplayX **서버**에서 실행합니다.

## 1. 세션 예약

```http
POST {BASE_URL}/sessions
Authorization: Bearer {AVATAR_ROUTER_PROJECT_API_KEY}
Content-Type: application/json

{
  "providerId": "anam",
  "avatarId": "anam-persona-default",
  "mode": "live",
  "pipeline": "anam_full",
  "costConfirmed": true
}
```

`avatarAssetId`, Tavus `fullPipeline` 옵션, `purpose=validation`은 지원하지 않습니다.
서비스 공통 정리 차단·용량·사용량 예산은 그대로 적용됩니다. Anam 전환은
미확인 Tavus 세션 차단을 우회하는 방법이 아닙니다.

응답 `id`로 `GET /sessions/{id}`를 조회합니다.
`status=active`, `rendererState=running`, `stopRequested=false`인 경우에만 다음 단계로 진행합니다.
`running`은 서버 토큰 준비 상태이며, 브라우저 영상 재생 확인 상태가 아닙니다.
생성 요청이나 엔진 시작을 자동 재시도하지 마세요.

## 2. 일회성 연결 정보

```http
POST {BASE_URL}/sessions/{id}/anam-connection
Authorization: Bearer {AVATAR_ROUTER_PROJECT_API_KEY}
```

응답:

```json
{
  "transport": "anam",
  "pipeline": "anam_full",
  "sessionToken": "<브라우저에만 전달할 임시 비밀>",
  "tokenExpiresAt": "<ISO timestamp>",
  "expiresAt": "<Router 종료 요청 기한>",
  "maxSessions": 1
}
```

이 요청은 한 번만 성공합니다. 응답 유실·중복 요청은
`ANAM_CONNECTION_ALREADY_ISSUED`로 처리되며 토큰을 재발급하지 않습니다.
새 유료 연결을 자동 생성하지 말고 해당 시도를 종료하세요.
토큰은 메모리에만 보관하고 로그, 분석 이벤트, URL, localStorage,
sessionStorage, 영구 쿼리 캐시에 저장하지 마세요.

## 3. 브라우저 SDK 연결

SDK `@anam-ai/js-sdk` 4.29.1 기준:

```ts
import { createClient, AnamEvent } from "@anam-ai/js-sdk";

// RoleplayX 자체 서버에서 위 응답을 받아옵니다. 프로젝트 키는 브라우저에 주지 않습니다.
const client = createClient(connection.sessionToken, {
  api: { retry: { maxAttempts: 1 } }
});

// 모든 리스너를 스트리밍 시작 전에 등록하세요.
client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => showConnected());
client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => showVideoPlaying());
client.addListener(AnamEvent.CONNECTION_CLOSED, () => requestRouterEndOnce());
await client.streamToVideoElement("anam-video");
```

```html
<video id="anam-video" autoplay playsinline></video>
```

`maxSessions=1`이므로 SDK 기본 시작 재시도를 그대로 사용하지 마세요.
`showConnected`, `showVideoPlaying`, `requestRouterEndOnce`는 RoleplayX가 구현할 UI/서버 연결 함수입니다.
영상/음성 출력, 마이크 권한, 자동재생 제한은 실제 브라우저에서 별도로 검증해야 합니다.
일반적인 끼어들기는 SDK `interruptPersona()`를 사용하고 세션 전체 종료와 구분하세요.

## 4. 종료와 정리

- 브라우저: `client.stopStreaming()`
- RoleplayX 서버: `POST /sessions/{id}/end`
- SDK 종료가 지연되더라도 서버 종료 요청은 반드시 보냅니다.
- Router는 브라우저가 보내는 외부 세션 ID를 신뢰하지 않고, 자체 생성한
  `clientLabel=avatarrouter-anam:{id}`와 정확히 일치하는 Anam 세션을 조회합니다.
- 활성 세션에는 Anam `/sessions/{providerId}/stop`을 요청한 뒤,
  다시 조회한 `endTime`으로 종료를 확인합니다. `/stop`의 200 또는 404만으로 해제하지 않습니다.
- 토큰을 전달했지만 세션을 아직 찾지 못했다면 토큰이 유효한 동안 정리를 유지합니다.
  만료 후 추가 유예 시간과 완전한 제공자 목록 조회로 세션 부재를 확인합니다.
- 조회 권한 오류·네트워크 실패·불완전한 목록은 완료로 처리하지 않습니다.
  운영자는 기존 라이브 조정 화면에서 종료·정리를 재요청할 수 있습니다.

### 시간·비용 주의

토큰은 120초 동안 한 번의 시작만 허용합니다. **토큰 만료는 활성 통화를 종료하지 않습니다.**
Router는 예약 후 120초 기한에 종료를 요청합니다. 이는 저장 페르소나에 강제되는
제공자 최대 통화시간 설정이 아니며, 장애 시 종료 확인까지 정리가 지연될 수 있습니다.
Anam Lab에서 저장 페르소나의 최대 세션 길이도 적절히 제한하세요.
실제 과금과 동시 연결 한도는 Anam 계정 정책을 따릅니다.

## 상태·오류

| 코드 | 조치 |
|---|---|
| `ANAM_KEY_REJECTED` | AvatarRouter 서버의 Anam 키 확인 |
| `ANAM_PERMISSION_DENIED` | 페르소나·토큰 및 세션 조회/종료 권한 확인 |
| `ANAM_PERSONA_NOT_FOUND` | 등록된 페르소나가 해당 Anam 계정에 속하는지 확인 |
| `ANAM_RATE_LIMITED` | 제공자 제한 확인, 유료 세션 자동 재시도 금지 |
| `ANAM_CONNECTION_ALREADY_ISSUED` | 기존 시도 종료, 토큰 재사용 금지 |
| `LIVE_CLEANUP_REQUIRED` / `LIVE_CAPACITY_REACHED` | 공통 생성 차단 상태 확인 |
| `LIVE_CLEANUP_PENDING` | 종료 접수와 완료를 구분하고 확인까지 대기 |

## 제공 범위와 검증

Playground에서 Anam을 선택하면 비용 동의 후 연결할 수 있습니다.
2026-11-09 개발 환경에서 실제 계정의 토큰 발급·네이티브 연결과
1152×768 영상 재생 및 프레임 증가를 확인했습니다. 한 세션만 시작했고,
종료 후 `rendererState=closed`, `cleanupPending=false`, 연결 비밀 정보 제거를 확인했습니다.
원격 오디오 트랙은 수신했지만 테스트 브라우저에 마이크 장치가 없어
`NotFoundError`가 발생했습니다. 실제 발화·소리가 들리는지·음성 인식·립싱크는 미검증입니다.
Provider의 `degraded` 표시는 이 남은 검증 범위를 뜻하며, 영상 연결 전체 실패를 뜻하지 않습니다.
운영 환경의 Anam 자격 증명과 재생은 별도 검증이 필요합니다.
RoleplayX 쪽 모드 선택, Gemini 중지, 네이티브 SDK 연결 및 Anam 대화 기록을
RoleplayX 평가에 연결하는 작업은 해당 앱에서 별도로 적용해야 합니다.

운영 적용에는 새 웹·API·Renderer Worker 게시가 필요합니다.
새 DB 컬럼은 추가하지 않았습니다.

공식 문서:
- https://anam.ai/docs/javascript-sdk/authentication
- https://anam.ai/docs/javascript-sdk/production
- https://anam.ai/docs/api-reference/sessions/create-session-token
- https://anam.ai/docs/api-reference/sessions/stop-session
