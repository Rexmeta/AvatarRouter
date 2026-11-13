# 라이브 준비 시간과 첫 영상 보고 이후 시간

## 지표와 신뢰 경계

`GET /api/v1/sessions/:id`와 워크스페이스 세션 목록의 `timing`은 다음을 반환한다.

- `routerElapsedSeconds`: 생성 접수부터 현재/종료 요청/종료/만료 중 가장 이른 시점까지. 준비 시간을 포함하며 예산의 시간 기준과 구분해 표시한다. 제공자 생성이 시작되지 않거나 거절된 경우 예산 사용량은 0일 수 있다.
- `clientVideoReportedAt`: 인증된 클라이언트의 첫 영상 프레임 보고를 **서버가 받은 시각**. 제공자 연결 완료 시각이 아니다.
- `preparationSeconds`: 생성 접수부터 최초 보고 수신까지. 네트워크 전송 지연을 포함한다.
- `connectedSeconds`: 최초 보고 수신부터 현재/종료 요청/종료/만료 중 가장 이른 시점까지.
- `evidence`: `not_reported` 또는 `authenticated_client_report`.

보고가 없으면 준비·연결 시간은 **null**이다. 과거 세션, 생성 성공, 토큰 발급, Renderer Worker의 `running` 상태에서 실제 영상 재생을 추정하지 않는다.
`connectedSeconds`는 연속 재생 시간, 음성 발화 시간, 실제 사용자 청취 시간 또는 제공자 청구 시간이 **아니다**. 중간 정지·네트워크 단절을 포함할 수 있다. 음소거된 영상 보고도 가능하며 오디오 확인을 의미하지 않는다.

이 보고는 인증된 사용자의 **주장**이다. 브라우저를 신뢰해 요금을 낮추거나 예산·예약·정리 차단을 바꾸지 않는다. 에셋 라이브 검증도 별도 절차다.

## RoleplayX 연결

기존 로그인과 Base URL + 프로젝트 API 키 구조는 그대로 둔다. 키의 `sessions:connect`가 필요하다. 브라우저가 프로젝트 키나 사용자 토큰을 공유받아 AvatarRouter에 직접 호출하면 안 된다.
RoleplayX 서버는 기존 로그인, 프로젝트/tenant 소속, 해당 세션을 사용할 권한을 다시 검증한 뒤 동일 사용자 컨텍스트로 아래 요청을 전달한다.

```http
POST /api/v1/sessions/:id/video-playing
Authorization: Bearer <server-side-project-api-key>
Content-Type: application/json

{"event":"video_frame_presented"}
```

소유자와 tenant가 정확히 일치해야 한다. 활성 live 세션이며 worker가 running이고 lease가 유효한 동안만 최초 보고를 받는다. 서버는 클라이언트가 보내는 시각·기간·tenant 값을 받지 않는다. 추가 필드도 거절한다.
첫 보고는 행 잠금으로 한 번만 저장한다. 중복 보고는 시각을 바꾸지 않으며, 중복 성공이 현재 세션의 활성 상태를 보장하지 않는다. 종료 뒤 들어온 **최초** 보고는 409로 거절한다.

공통 브라우저 SDK:

```ts
const client = createClient({
  connection, video, endSession, onAudioOwner,
  reportVideoPlaying: async (id, observation) => {
    const response = await fetch(`/your-authenticated-proxy/sessions/${id}/video-playing`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(observation),
    });
    if (!response.ok) throw new Error('VIDEO_TIMING_REPORT_FAILED');
  },
  onTimingReport: state => {
    // saved / failed: 실패를 재생 실패나 정리 완료로 바꾸지 않는다.
    // failed이면 UI에서 시간 관측 실패로 표시한다. 세션 생성 재시도는 하지 않는다.
  },
});
```

SDK는 토큰 발급이나 RTC connected가 아니라 `requestVideoFrameCallback`에서 크기가 있는 영상 프레임이 표시된 뒤 보고한다. 미지원 브라우저는 영상 크기와 실제 media time 증가를 확인한다. 중복 playing 이벤트나 재연결로 최초 시각을 덮어쓰지 않는다.
SDK를 사용하지 않는 클라이언트도 동일한 실제 프레임 조건을 적용한다. 단순 loadeddata/track 구독만으로 보고하지 않는다.
새 SDK 옵션을 연결하지 않은 기존 앱은 계속 작동하지만 `not_reported`로 남는다. 이 문서는 RoleplayX 소스가 자동 변경되거나 운영 배포되었다는 뜻이 아니다.

세션 GET을 기존처럼 폴링하고 `timing`을 표시한다. 종료 후 숫자는 고정된다. 보고 실패는 영상 종료나 새 유료 세션 생성의 이유로 사용하지 않는다.

## 재생·중단 별도 관측 (`playback_observations_v1`)

`connectedSeconds`와 첫 영상 보고 시각은 변경하지 않는다. 선택적인 `timing.playback`은 다음을 구분한다.

- `observedPlayingSeconds`: 동일 보고자의 연속 보고 사이에서 앞선 상태가 playing이었던 구간.
- `observedInterruptedSeconds`: 동일 조건에서 앞선 상태가 paused/stalled/disconnected였던 구간.
- `unknownSeconds`: 첫 영상 보고 이후 나머지. 최초 관측 전 공백, 누락, 새로고침, 마지막 미확인 구간 및 초 단위 절삭 잔여를 포함한다.
- `currentState`: 최근 상태. 12초 초과 무응답, 종료/만료, worker lease 유실이면 unknown.
- `lastReportAt`, `gapCount`, `evidence`: 마지막 서버 수신 시각, 불연속 구간 수, not_reported/authenticated_client_reports.

첫 영상 보고가 없으면 unknownSeconds도 null이다. 첫 보고만 있고 별도 관측이 없으면 이후 전체가 불명이다.
서버 수신 시각 사이의 **클라이언트 주장 기반 근사 구간**이며, 네트워크·이벤트 감지 지연을 포함한다.
실제 연속 재생·음성 발화·청취·제공자 청구를 증명하지 않는다.

### 인증된 관측 프록시

`sessions:connect`와 기존 소유자·tenant 검증으로 다음을 전달한다. 클라이언트 시각·기간·tenant·추가 필드는 받지 않는다.

```http
POST /api/v1/sessions/:id/playback-observations
Content-Type: application/json
Authorization: Bearer <server-side-project-api-key>

{"event":"start","reporterId":"<random UUID per observer>","sequence":1,"state":"playing"}
```

후속 보고는 event sample과 증가하는 sequence를 사용한다.
상태는 playing/paused/stalled/disconnected/unknown이다.
start는 sequence 1, sample은 2 이상이다. 응답은 기존 Session이다.
활성 live 세션·유효 worker lease·기존 첫 영상 보고가 있어야 새 관측을 받으며 최초 보고 시각은 바꾸지 않는다.

- 약 5초 heartbeat. 같은 보고자·정확히 다음 sequence·수신 간격 12초 이하일 때만 앞선 상태의 구간을 집계한다.
- 순서를 건너뛰거나 12초 초과면 사이 전체가 불명이다. 누락 보고를 보간하거나 나중에 소급해 채우지 않는다.
- 중복·역순은 마지막 수신 시각과 집계를 바꾸지 않는다.
- 새로고침은 새 UUID의 명시적 start로 새 세대를 시작한다. 두 세대 사이 전체는 불명이며 교체된 보고자의 start/sample은 409다.
- 한 세션에 최대 32개 보고자 세대만 보존한다. 한도 초과 409는 재생·세션에 영향을 주지 않는다.
- 여러 탭이 경쟁하면 서버에 마지막으로 수락된 새 start가 기준이다. 실제 브라우저 생성 순서는 독립 검증하지 않는다. 지연된 최초 start가 뒤늦게 수락될 수도 있으므로 앱은 단일 관측자만 사용한다.
- 종료 뒤 새 보고는 409다. 이전 보고의 중복 성공은 종료 상태나 마지막 수신 시각을 바꾸지 않는다.
- 마지막 보고부터 현재/종료까지는 항상 불명이다. 마지막 상태를 임의로 늘려 집계하지 않는다.

### SDK와 안전 경계

기존 공통 SDK 옵션에 다음을 추가한다. 외부 앱은 자기 로그인 프록시를 사용하며 브라우저에 프로젝트 키를 주지 않는다.

```ts
reportPlaybackObservation: async (id, observation) => {
  const response = await fetch(`/your-authenticated-proxy/sessions/${id}/playback-observations`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(observation),
  });
  if (!response.ok) throw new Error('PLAYBACK_OBSERVATION_REPORT_FAILED');
},
onPlaybackReport: state => {
  // saved / failed: 관측 안내만 갱신한다. start/end/interrupt를 호출하지 않는다.
},
```

SDK는 첫 실제 프레임 보고 시도 이후 관측을 시작한다. 재개는 새 실제 프레임 또는 구형 브라우저의 advancing media time으로 판단한다.
DOM playing만으로 재개를 주장하지 않는다. pause/waiting/stalled/emptied/offline과 프레임 진행 없음도 관측한다.
백그라운드 visibility는 정지로 단정하지 않고 unknown으로 보고하며 visible 복귀 후에도 새 프레임 전까지 불명이다.
최초 관측 start 실패 시 관측자만 닫는다. sample 실패는 재전송 없이 다음 sample을 계속한다.
전송 중 발생해 보낼 수 없던 변경은 sequence를 건너뛰어 서버가 해당 공백을 불명으로 처리한다.
응답 제한 8초, 동시에 하나의 보고만 진행하며 종료 시 listener/timer를 정리한다.
시간 초과는 host의 요청이 아직 살아 있을 수 있으므로 관측자만 닫아 미완료 요청 누적을 막는다. 재생·세션은 종료하지 않는다.
pagehide 전달은 보장하지 않는다.
보고 실패·유실·조작으로 예산·예약·정리 차단·에셋 검증·유료 세션 수명이 변경되지 않는다.

AvatarRouter native/stock 테스트는 이 옵션을 연결했다.
RoleplayX의 첫 영상 보고 연결만으로 이 추가 endpoint가 자동 프록시되지는 않는다.
외부 앱의 새 옵션·프록시·UI 연결 및 실제 유료 통화 검증은 별도다.

## 배포

API/Worker를 같은 소스로 빌드하고, additive migration의 nullable `client_video_reported_at` 및 `playback_observation` 컬럼을 먼저 적용한다. 기존 세션의 연결·중단 시간을 추정해 채우지 않는다. 브라우저 SDK도 새 번들로 배포한 후 외부 앱 프록시를 연결해야 한다. 운영 배포·실제 유료 통화 검증은 별도다.
