# AvatarRouter 관리형 클라이언트 연동 · API 0.9

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
| 제공자별 끼어들기·연결 종료 | 자기 서버의 공통 end/interrupt/status 프록시 |
| 세션 정리 확인·용량/비용 차단 | 기존 Gemini 엔진의 실행/로컬 출력 권한 전환 |

프로젝트 키는 서버에만 보관합니다. 공용 사용자 토큰·Clerk 세션·JWT 서명 비밀을 공유하지 않습니다.
공통 클라이언트에 전달하는 임시 연결 정보 역시 비밀이며 메모리에서만 사용합니다.
공통 스크립트는 AvatarRouter가 제공하는 제공자 SDK 번들이므로 RoleplayX의 CSP에서
설정한 AvatarRouter 스크립트 출처 및 제공자 미디어 통신을 허용해야 할 수 있습니다.

## 연결 흐름

Anam/Tavus에 매 대화의 특성·시나리오를 전달하려면 [페르소나·시나리오 가이드](./roleplay-context.md)의 공통 `roleplay` 입력을 사용하세요. 제공자 키·브라우저 SDK 설정은 추가하지 않습니다.

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

아래 `roleplayxFetch`, `setExistingVoicePolicy`, `showAvatarState`, `showCleanupState`는 기존 앱에 맞게
연결할 함수입니다. **제공자별 구현 함수가 아닙니다.**
`roleplayxFetch`는 HTTP 오류를 reject하고 성공 응답의 JSON을 반환하는 함수로 가정합니다.

```js
// SDK 옵션과 구버전 호환 조회가 공유하는 인증된 읽기 전용 프록시입니다.
const getSessionStatus = (sessionId) => roleplayxFetch(
  `/avatar/${localConversationId}/status?sessionId=${encodeURIComponent(sessionId)}`,
  { method: "GET", cache: "no-store" }
);

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
  // 선택형 읽기 전용 프록시. 서버는 아래 sessionId와 로컬 대화의 매핑을 검사합니다.
  getSessionStatus,
  onCleanupState: (state, code) => showCleanupState(state, code),
  interruptSession: () => roleplayxFetch(`/avatar/${localConversationId}/interrupt`, {
    method: "POST"
  }),
  onState: (state, code) => showAvatarState(state, code)
});

await client.start();     // 시작 1회만 허용
// 사용자 끼어들기: await client.interrupt(); -- 전체 세션 종료가 아닙니다.
// 기존 앱의 사용자 종료 버튼에 연결할 함수:
async function endAvatarConversation() {
  showCleanupState("pending");
  try {
    await client.stop(); // 로컬 종료 + end 요청 시도. 서버 정리 완료를 기다리지 않습니다.
  } finally {
    const result = await refreshCleanupSafely(client, descriptor.sessionId, getSessionStatus);
    showCleanupState(result.state, result.code);
  }
}
// 아래 호환 함수도 함께 복사합니다. getSessionStatus는 위 옵션과 같은 인증된 GET 프록시입니다.
// "정리 상태 다시 확인" 버튼도 refreshCleanupSafely() 결과를 showCleanupState()에 전달합니다.
// 화면 이탈에서는 client.stop()만 시도하고, 다음 방문 시 서버에서 상태를 복구합니다.
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
  기존 `onState` 값과 `stop(): Promise<void>` 계약은 그대로 유지됩니다.
- `/end`의 HTTP 성공·응답 접수·`status=ended`만으로 **새 유료 생성 가능**으로 표시하지 않습니다.
  서버가 종료를 접수한 뒤에도 제공자 정리 또는 늦은 시작 방지 처리가 남을 수 있습니다.
- `CLIENT_START_FAILED`는 비밀 정보가 제거된 공통 오류입니다. 원인은 같은 세션의
  상태와 안전한 서버 진단에서 확인하고 새 유료 세션을 자동 생성하지 않습니다.
- 연결 정보, 프로젝트 키, 제공자 토큰, 제공자 연결 URL을 로그·분석·브라우저 저장소에 넣지 않습니다.
- SDK가 로드되기 전에 실패해도 RoleplayX 서버는 예약한 세션에 `/end`를 요청해야 합니다.

### 선택형 정리 확인 계약

#### SDK 버전과 기능 탐지

- REST API `0.9`와 브라우저 번들 `AvatarRouter.version`은 별도 버전입니다.
  이번 번들은 `0.9.1`이며 `AvatarRouter.features`에 `cleanup_status_v1`을 제공합니다.
  이 기능은 `getSessionStatus`, `onCleanupState`, `cleanupState`, `refreshCleanup()` 계약을 뜻합니다.
- 이전 `0.9.0` 번들은 같은 버전 문자열이어도 배포 시점에 따라 정리 메서드 유무가 다를 수 있습니다.
  캐시·고정 파일에는 버전이나 기능 목록도 없을 수 있으므로 **버전 문자열 비교만으로 호출하지 않습니다.**
  `Array.isArray(AvatarRouter.features)` 및 목록 포함 여부는 참고용이며,
  최종 호출 조건은 `typeof client?.refreshCleanup === "function"`입니다.
  기능 목록이 없어도 실제 메서드가 있으면 사용할 수 있습니다.
- 구버전은 새 옵션을 무시할 수 있습니다. `onCleanupState` 콜백이 오지 않는 것이 완료 증거는 아닙니다.
  아래 함수는 메서드가 없으면 같은 세션의 서버 상태만 조회합니다. SDK나 프록시가 없으면
  `unknown / CLIENT_SDK_UPDATE_REQUIRED`를 반환하고, 앱은 “정리 확인 필요 · SDK/상태 조회 연동 업데이트 필요”를
  표시합니다. 예외로 종료 흐름을 끊거나 `ended`로 정리 완료를 추정하지 않습니다.

아래 공통 호환 함수를 앱에 두세요. 제공자 SDK나 프로젝트 키가 필요하지 않습니다.
반환된 `state`가 `unknown/pending`이면 생성 버튼 잠금을 유지합니다.

```js
// cleanup-compat-example:start
async function refreshCleanupSafely(client, sessionId, getSessionStatus) {
  const unknown = (code) => ({ state: "unknown", code });
  let timer;
  const bounded = (operation) => Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("STATUS_TIMEOUT")), 8000);
    })
  ]);
  try {
    if (typeof sessionId !== "string" || !sessionId) {
      return unknown("ROUTER_STATUS_INVALID");
    }
    if (typeof client?.refreshCleanup === "function") {
      // 세션이 다른 클라이언트의 완료 결과를 사용하지 않습니다.
      if (client.sessionId !== sessionId) return unknown("ROUTER_STATUS_INVALID");
      const state = await bounded(() => client.refreshCleanup());
      return ["unknown", "pending", "confirmed"].includes(state)
        ? { state } : unknown("ROUTER_STATUS_INVALID");
    }
    if (typeof getSessionStatus !== "function") {
      return unknown("CLIENT_SDK_UPDATE_REQUIRED");
    }
    const status = await bounded(() => getSessionStatus(sessionId));
    if (!status || status.id !== sessionId
      || typeof status.cleanupPending !== "boolean"
      || !(status.rendererState === null || typeof status.rendererState === "string")) {
      return unknown("ROUTER_STATUS_INVALID");
    }
    return {
      state: status.rendererState === "closed" && status.cleanupPending === false
        ? "confirmed" : "pending"
    };
  } catch {
    // HTTP 실패·403·404·시간 초과 모두 미확인. 원본 오류/응답을 UI나 로그에 전달하지 않습니다.
    return unknown("ROUTER_STATUS_UNCONFIRMED");
  } finally {
    clearTimeout(timer);
  }
}
// cleanup-compat-example:end
```

이 함수는 1회 조회만 하며 자동 폴링·세션 생성·토큰 발급·미디어 시작을 하지 않습니다.
복구 화면에서는 `client` 대신 `null`과 서버에 저장된 세션 매핑을 전달할 수 있습니다.
동시에 여러 조회를 실행하지 말고 조회 중 다시 확인 버튼을 비활성화하세요.
종료 중에는 `stop()` 시도 이후에만 조회하고, 종료 전에 시작한 조회 결과는 폐기하세요.
계정 전환·화면 이탈 후에는 진행 중인 결과도 적용하지 않도록 앱의 계정/화면 식별자를 검사하세요.

SDK 업데이트는 통화가 끝난 뒤 호스팅 스크립트의 캐시(브라우저·서비스 워커·CDN)를 재검증하거나,
고정한 SDK 파일을 검증된 최신 파일로 교체하는 작업입니다. 현재 통화 중 스크립트를 재삽입하거나
클라이언트를 재시작하지 않습니다. 스크립트 경로는 `/sdk/avatarrouter-client.js` 그대로이며
버전별 URL을 제공한다는 뜻이 아닙니다. **업데이트/정리 조회를 위해 `/client-connection`을
다시 호출하거나 새 세션을 만들지 않습니다.** 기존 세션 ID로 인증된 GET만 계속 사용합니다.
`/auth/check`의 서버 기능 지원은 로드된 브라우저 SDK가 최신이라는 증거가 아닙니다.

새 SDK의 `getSessionStatus(sessionId)`는 RoleplayX 자신의 인증된 서버를 통해
**`GET {BASE_URL}/sessions/{id}`만** 호출합니다. 브라우저에 프로젝트 키를 전달하지 않습니다.
RoleplayX 서버는 기존 로그인·사용자·tenant·로컬 대화와 세션 매핑을 확인한 뒤,
기존 서버 전용 프로젝트 API 키로 조회하고 `Cache-Control: private, no-store`를 적용합니다.
성공 응답의 아래 필드를 그대로 전달하면 됩니다. 토큰·연결 정보·운영자 진단은 필요 없습니다.

```json
{ "id": "<owned-session-id>", "rendererState": "closed", "cleanupPending": false }
```

| 정리 상태 | 의미 | 화면 처리 |
|---|---|---|
| `unknown` | 초기 상태, 조회 프록시 없음, 실패·권한 오류·시간 초과·잘못된 응답 | 정리 확인 필요, 새 생성 잠금 유지 |
| `pending` | 종료 시도 시작 또는 조회 결과가 아직 정리 완료 조건을 충족하지 않음 | 서버 정리 중, 새 생성 잠금 유지 |
| `confirmed` | 같은 세션 조회에서 `rendererState === "closed"` **및** `cleanupPending === false` 확인 | 해당 세션 정리 확인 완료 |

- `client.cleanupState`로 현재 값을 읽고 `onCleanupState(state, code)`로 변화를 받습니다.
  `ended`와 별도이며 `onState`에 새 값을 추가하지 않습니다. 이 옵션을 생략한 기존 연동도 동작하지만,
  종료나 로컬 화면만으로 정리를 확인할 수는 없습니다.
- `await client.refreshCleanup()`은 정리 상태를 반환합니다. 자동 조회·자동 재시도는 하지 않습니다.
  `getSessionStatus`가 없으면 `unknown / CLIENT_STATUS_PROXY_REQUIRED`,
  실패하면 `unknown / ROUTER_STATUS_UNCONFIRMED`, 잘못된 응답이면
  `unknown / ROUTER_STATUS_INVALID`를 전달합니다. 원본 오류·비밀 정보는 전달하지 않습니다.
  조회는 최대 8초 기다리며 동시 호출은 하나로 합칩니다.
- `stop()`과 동시에 호출하면 종료 요청 시도가 끝난 뒤 조회합니다.
  종료 전에 시작한 오래된 조회는 종료 이후 정리 상태를 덮어쓰지 않습니다.
  `stop()`은 정리 상태를 `pending`으로 바꾸며, end 응답 자체로 `confirmed`로 바꾸지 않습니다.
- `pending/unknown`이면 수동 다시 확인 또는 횟수·기간이 제한된 앱의 조회만 사용합니다.
  네트워크 실패·404·403은 정리 완료 증거가 아닙니다. 조회 실패 시 생성 버튼을 열지 않습니다.
  계정 전환·화면 이탈 시 앱의 조회 타이머를 중지하고 이전 계정의 상태 표시를 폐기합니다.
- **조회 재시도 과정에서 `POST /sessions`, `/client-connection`, `/anam-connection`,
  `/full-connection`, `/connection`을 호출하지 않습니다.** 생성·토큰 재발급·미디어 재시작은
  정리 확인 방법이 아닙니다. 새로고침 후에도 저장된 로컬 대화 매핑으로 서버 조회만 복구하며,
  조회를 위해 클라이언트 연결 정보를 다시 받거나 새 클라이언트를 시작하지 않습니다.
- `confirmed`는 **해당 세션의 정리 확인**일 뿐, 새 유료 생성의 허가가 아닙니다.
  다른 미정리 세션, 프로젝트/사용자 한도, 서버의 `creationAllowed` 및 기존 비용 동의 등
  모든 생성 조건을 별도로 확인하고 최종 서버 차단을 유지합니다.

## 현재 검증 범위

Anam의 기존 네이티브 경로는 개발 환경에서 실제 영상·종료·정리 성공을 확인했습니다.
이 공통 API/클라이언트 래퍼는 타입 검사·모의 테스트·번들 빌드로 검증하며,
새 래퍼를 통한 실제 제공자별 통화와 RoleplayX 운영 앱 연동은 아직 검증하지 않았습니다.
이번 작업에서 새로운 실제 제공자 세션을 만들지 않습니다.

공통 클라이언트의 `onMessages(messages)`는 두 제공자의 실시간 자막을
`[{id, role: "user" | "assistant", text}]` 형식으로 전달합니다. 이 값은 임시 자막이며 최종 증거가 아닙니다.
두 제공자 모두 `GET /sessions/{id}/transcript`로 최종 기록을 조회합니다.
`pending`이면 종료·기록 확정을 기다리고, `unavailable`이면 보관 설정·기록 만료를 확인합니다.
`ready`일 때만 정규화된 `messages`, `revision`, `final: true`가 반환됩니다.
기존 Tavus 응답과 operationId는 유지하고 `source: "anam"`을 추가했습니다.
제공자 기록 조회·정규화는 AvatarRouter 책임이고, 그 기록을 이용한 RoleplayX 점수 계산·영구 보관은 애플리케이션 책임입니다.
실제 대화의 컨텍스트 준수 및 제공자 기록 생성은 추가 비용 동의 후 별도 검증이 필요합니다.
