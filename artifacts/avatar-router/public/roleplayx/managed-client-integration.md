# AvatarRouter 관리형 클라이언트 연동 · API 0.8

## 운영 원칙

RoleplayX 관리자가 등록할 외부 서비스 설정은 **AvatarRouter Base URL + 프로젝트 API 키**입니다.
Anam/Tavus/LiveKit 키, 제공자 SDK 설치, 제공자별 연결 주소 분기는 요구하지 않습니다.

영상 서비스는 텍스트 API와 달리 브라우저의 마이크·재생 처리가 필요합니다.
따라서 RoleplayX 개발 시 **한 번의 공통 클라이언트 연결**은 필요합니다.
그 클라이언트 코드는 AvatarRouter가 호스팅하고 배포합니다.
단순히 키를 저장하는 것만으로 기존 앱에 영상 화면이 자동으로 생기지는 않습니다.

| AvatarRouter 책임 | RoleplayX 책임 |
|---|---|
| 제공자 키·토큰 발급·SDK 선택 | 기존 로그인·사용자·tenant 권한 검사 |
| Anam / Tavus / LiveKit 연결 차이 | 선택한 페르소나·대화 모드 전달 |
| 영상·원격 음성 재생 | 공통 비디오 요소와 클라이언트 호출 |
| 제공자별 끼어들기·연결 종료 | 자기 서버의 공통 end/interrupt 프록시 |
| 세션 정리 확인·용량/비용 차단 | 기존 Gemini 엔진의 실행/로컬 출력 권한 전환 |

프로젝트 키는 서버에만 보관합니다. 공용 사용자 토큰·Clerk 세션·JWT 서명 비밀을 공유하지 않습니다.
공통 클라이언트에 전달하는 임시 연결 정보 역시 비밀이며 메모리에서만 사용합니다.
공통 스크립트는 AvatarRouter가 제공하는 제공자 SDK 번들이므로 RoleplayX의 CSP에서
설정한 AvatarRouter 스크립트 출처 및 제공자 미디어 통신을 허용해야 할 수 있습니다.

## 연결 흐름

1. RoleplayX 서버가 기존 사용자와 페르소나 사용 권한을 검사합니다.
2. 기존 `POST /sessions`로 선택한 아바타와 파이프라인을 요청합니다.
   선택은 명시적이며 Gemini에서 다른 엔진으로 자동 전환하지 않습니다.
3. 같은 세션을 조회해 `status=active`, `rendererState=running`, `stopRequested=false`를 확인합니다.
4. **모든 제공자에서 동일한** 아래 API를 한 번 호출합니다.

```http
POST {BASE_URL}/sessions/{id}/client-connection
Authorization: Bearer {AVATAR_ROUTER_PROJECT_API_KEY}
```

```json
{
  "sessionId": "<owned-session-id>",
  "pipeline": "anam_full",
  "audioOwner": "avatarrouter",
  "clientScriptPath": "/sdk/avatarrouter-client.js",
  "expiresAt": "<ISO timestamp>",
  "connection": "<실제 응답은 SDK 전용 비밀 객체>"
}
```

5. RoleplayX 서버는 응답에 `Cache-Control: private, no-store`를 설정하고,
   해당 대화를 사용할 권한이 있는 자신의 브라우저에만 전달합니다.
   프로젝트 API 키가 프로젝트 전체 권한을 가질 수 있으므로 서버에서 사용자·tenant별
   로컬 대화와 AvatarRouter 세션 매핑을 반드시 검사해야 합니다.
6. 브라우저가 `clientScriptPath`의 공통 스크립트를 로드하고 `AvatarRouter.createClient()`를 호출합니다.
   `connection` 객체 내부는 해석하지 않고 그대로 전달합니다.

`GET /auth/check` 응답의 `integration.features`에 `unified_client_connection`, `hosted_browser_client`가
있는지 먼저 확인합니다. 이전 버전에 이 기능이 없으면 게시 후 사용해야 합니다.
`/anam-connection`, `/full-connection`, `/connection`은 기존 클라이언트 호환용으로 남아 있지만,
새 연동에서는 제공자별 API를 직접 선택하지 마세요. 특히 Anam은 연결 정보를
한 번만 전달하므로 두 경로를 함께 호출하거나 자동 재시도하면 안 됩니다.

## 브라우저 예시

아래 `roleplayxFetch`, `setExistingVoicePolicy`, `showAvatarState`는 기존 앱에 맞게
연결할 함수입니다. **제공자별 구현 함수가 아닙니다.**

```js
// 서버에서 검증한 AvatarRouter origin과 공통 API 응답을 받습니다.
const descriptor = await roleplayxFetch(`/avatar/${localConversationId}/client-connection`, {
  method: "POST"
});

// 한 번 로드하고 재사용합니다. <script> classic 번들이므로 SDK 패키지 설치가 필요 없습니다.
await new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = new URL(descriptor.clientScriptPath, avatarRouterOrigin).href;
  script.onload = resolve;
  script.onerror = reject;
  document.head.append(script);
});

const client = AvatarRouter.createClient({
  connection: descriptor,
  video: document.getElementById("avatar-video"),
  // 반드시 구현: 미디어 시작 전에 음성 엔진 권한을 전환합니다.
  onAudioOwner: async (owner) => {
    await setExistingVoicePolicy({
      generateWithExistingEngine: owner === "application",
      playExistingLocalAudio: false
    });
  },
  endSession: () => roleplayxFetch(`/avatar/${localConversationId}/end`, {
    method: "POST", keepalive: true
  }),
  interruptSession: () => roleplayxFetch(`/avatar/${localConversationId}/interrupt`, {
    method: "POST"
  }),
  onState: (state, code) => showAvatarState(state, code)
});

await client.start();     // 시작 1회만 허용
// 사용자 끼어들기: await client.interrupt(); -- 전체 세션 종료가 아닙니다.
// 대화 종료/화면 이탈: await client.stop();
```

```html
<video id="avatar-video" autoplay playsinline></video>
```

`audioOwner=application`은 기존 Gemini 등이 **생성**을 담당한다는 뜻입니다.
기존 `POST /sessions/{id}/audio`로 생성한 PCM을 계속 전송하고,
로컬 출력만 꺼서 아바타 원격 음성과 중복되지 않게 합니다.
로컬 출력 전환을 사용자 끼어들기로 취급해서는 안 됩니다.

`audioOwner=avatarrouter`이면 Anam/Tavus full pipeline이 마이크·대화·음성을 담당합니다.
Gemini 마이크 전송과 응답 생성을 중지합니다. 네이티브 모드에는 Gemini PCM을 보내지 않습니다.
기존 RoleplayX 엔진의 실행 상태는 AvatarRouter가 다른 앱의 메모리를 직접 제어할 수 없으므로,
이 공통 소유권 콜백으로 한 번 연결해야 합니다.

## 종료와 오류

- 공통 클라이언트는 자동 엔진 재시도·재연결을 하지 않습니다.
- `stop()`은 SDK 종료와 RoleplayX 서버의 공통 `/end`를 각각 실행합니다.
  SDK 종료가 멈추더라도 서버 종료 요청은 먼저 보냅니다.
- 페이지 이탈과 만료에도 같은 종료를 요청합니다. 네트워크가 끊긴 페이지에서는
  전송을 보장할 수 없으므로 Router Worker의 기한·제공자 정리 절차도 유지됩니다.
- `ended` 이벤트는 **로컬 재생 종료**이며 제공자 정리 완료를 뜻하지 않습니다.
  서버 세션의 `rendererState=closed`, `cleanupPending=false`를 확인합니다.
- `CLIENT_START_FAILED`는 비밀 정보가 제거된 공통 오류입니다. 원인은 같은 세션의
  상태와 안전한 서버 진단에서 확인하고 새 유료 세션을 자동 생성하지 않습니다.
- 연결 정보, 프로젝트 키, 제공자 토큰, 제공자 연결 URL을 로그·분석·브라우저 저장소에 넣지 않습니다.
- SDK가 로드되기 전에 실패해도 RoleplayX 서버는 예약한 세션에 `/end`를 요청해야 합니다.

## 현재 검증 범위

Anam의 기존 네이티브 경로는 개발 환경에서 실제 영상·종료·정리 성공을 확인했습니다.
이 공통 API/클라이언트 래퍼는 타입 검사·모의 테스트·번들 빌드로 검증하며,
새 래퍼를 통한 실제 제공자별 통화와 RoleplayX 운영 앱 연동은 아직 검증하지 않았습니다.
이번 작업에서 새로운 실제 제공자 세션을 만들지 않습니다.

이 공통 클라이언트는 미디어 연결용입니다. RoleplayX 시나리오의 평가·저장 및
제공자별 전체 transcript 정규화까지 자동 구현된 것으로 해석하면 안 됩니다.
기존 Tavus 최종 transcript API는 그대로 사용하며 Anam 평가 연결은 별도 검증이 필요합니다.
