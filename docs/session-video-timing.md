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

## 배포

API/Worker를 같은 소스로 빌드하고, additive migration의 nullable `client_video_reported_at` 컬럼을 먼저 적용한다. 기존 세션 데이터의 연결 시각을 추정해 채우지 않는다. 브라우저 SDK도 새 번들로 배포한 후 RoleplayX 프록시를 연결해야 한다. 운영 배포·실제 유료 통화 검증은 별도다.
