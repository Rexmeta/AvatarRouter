# 캐시된 SDK 교체와 정리 안내 검증

## 범위와 실행

이 검사는 VM 테스트가 확인하지 못하는 **실제 브라우저 HTTP 캐시와 서비스 워커 CacheStorage**를 확인한다.
CDN은 운영 배포를 건드리지 않는 격리된 HTTP 응답 서버로 재현한다. 실제 CDN 사업자의 캐시 설정을
확인하거나 외부 RoleplayX 앱을 배포·로그인한 검사는 아니다.

```sh
pnpm --filter @workspace/scripts run test:sdk-cache:prepare
```

AvatarRouter의 기존 개발 서버를 시작하고 `/__sdk-cache-test/`에서 **전체 검증 실행**을 누른다.
마지막 결과는 `PASS`, `window.cacheDeliveryDone === true`여야 한다.
상세 결과는 `window.cacheDeliveryReport` 또는 화면의 JSON으로 확인한다.
브라우저 자동화 도구에서 네트워크 라우팅/캐시 비활성화를 켜지 않는다.

- 생성한 번들은 Git/배포 제외 대상 `generated-artifacts/sdk-cache-delivery/`에만 저장한다.
- 준비 명령을 실행하지 않은 작업 공간에서는 검증 경로가 404를 반환한다.
- 검증 경로는 Vite 개발 미들웨어 전용이다. production build/preview에는 등록되지 않는다.
- 준비 명령은 이전 SDK의 실제 Git 소스를 사용한다. 기록이 없는 얕은 체크아웃에서는
  Git 소스를 복원한 뒤 실행해야 하며, 가짜 구버전으로 대체하지 않는다.
- API 서버와 Renderer Worker는 필요하지 않으며 이 검증에서는 시작하지 않았다.

## 입력 번들

| 이름 | 출처 | 확인 목적 |
|---|---|---|
| legacy | `4c6e170`의 SDK 및 SDK 내부 의존 소스 | `0.9.0`, 정리 메서드 없음 |
| transitional | `398a406`의 SDK 및 SDK 내부 의존 소스 | 동일한 `0.9.0`이지만 정리 메서드 있음 |
| pinned | 현재 실제 IIFE에서 `version/features` 내보내기만 제거 | 메타데이터 없이 실제 메서드 탐지 |
| latest | 현재 배송용 entry/build 설정의 IIFE | `0.9.1`, 불변 `cleanup_status_v1` 목록 |

호환 함수는 `public/roleplayx/managed-client-integration.md`의 표시된 예제를 그대로 추출한다.
별도 구현으로 바꾸지 않는다. SDK에도 기능 판별을 위한 수정은 하지 않았다.

## 캐시 조건과 목표 판정

| 전달 조건 | 최신 파일 교체 후, 캐시 무효화 전 | 캐시 무효화/고정 파일 교체 후 |
|---|---|---|
| 브라우저 HTTP 캐시 (`max-age=3600`) | `0.9.0` 유지, 추가 SDK 원본 요청 없음 | 같은 URL에서 `0.9.1` |
| CDN 재현 (`X-Cache: HIT`, `Age: 120`) | 원본은 최신이지만 edge가 `0.9.0` 반환 | edge 제거 + HTTP 캐시 재검증 후 `0.9.1` |
| 실제 서비스 워커 cache-first | 원본 교체 후에도 CacheStorage의 `0.9.0`, 추가 원본 SDK 요청 없음 | 해당 테스트 캐시 purge + 워커 내부 `cache: reload` 재검증 후 `0.9.1` |
| 메타데이터 없는 고정 파일 | 버전·기능 목록 없이도 정리 메서드 사용 | 고정 파일 교체 후 `0.9.1` |
| 정리 메서드가 있는 `0.9.0` | 버전이 아니라 실제 메서드 사용 | `0.9.1` |

캐시가 남아도 구버전 클라이언트는 같은 세션의 인증된 GET 프록시로 대체된다.
프록시가 없으면 `unknown / CLIENT_SDK_UPDATE_REQUIRED`와 업데이트 안내를 유지한다.
업데이트는 iframe을 제거한 다음 수행한다. 통화 중 재삽입·재시작은 하지 않는다.

각 조건에서 확인하는 공통 항목:

- 동일 세션의 `rendererState: closed` 및 `cleanupPending: false`만 `confirmed`.
- 정리 중은 `pending`; 로컬 `ended`만 있는 응답, 다른 사용자 세션(403), 없는 세션(404)은 `unknown`.
- 클라이언트 없는 저장 세션 조회도 같은 GET 프록시 사용.
- 조회 응답은 `private, no-store`; 테스트 로그인 쿠키를 제거하면 401.
- 정리 확인이나 SDK 업데이트만으로 새 유료 생성 버튼을 활성화하지 않음.
- SDK 클라이언트 생성에 세션 ID/오디오 소유권 메타데이터만 전달하고,
  transport·토큰·제공자 URL·실제 video 요소를 전달하지 않음.
- `start/stop/interrupt`, 미디어·마이크·WebSocket·WebRTC·저장소 쓰기 감시가 모두 0회.
- 서버 측 요청 기록에는 세션 상태 GET만 있으며, 예상치 않은 lifecycle/token 경로는 거부.

## 인증과 안전 경계

테스트 데이터는 미리 정의한 `stored-closed`, `stored-pending`, `stored-ended` 세션이다.
테스트 전용 HttpOnly 쿠키로 소유자를 확인하고 다른 소유자/없는 세션은 각각 403/404로 처리한다.
이는 **실제 Clerk 로그인, 실제 사용자 DB 또는 RoleplayX 운영 프록시의 인증 검증을 대신하지 않는다.**
캐시 전달을 분리해 확인하기 위한 인증된 상태 조회 fixture이며, 실제 제공자 세션/토큰은 생성하지 않는다.
테스트 제어 POST는 격리된 캐시 출처와 테스트 쿠키만 변경하며 실제 세션에는 접근하지 않는다.

각 실행은 고유 경로를 사용한다. 실행 종료 시 해당 서비스 워커만 해제하고 해당 캐시만 삭제한다.
다른 앱의 서비스 워커/캐시는 건드리지 않는다. SDK 번들을 계속 덧붙이거나 유료 생성 차단을 풀지 않는다.

미리보기 접속에도 별도 인증 쿠키가 있을 수 있으므로 비로그인 검사에서 `credentials: omit`를
사용하지 않는다. 테스트 쿠키만 만료시키고 미리보기 접속 쿠키는 유지해야 실제 fixture의 401을 검증한다.

## 관련 검사

```sh
pnpm --filter @workspace/scripts exec tsx --test \
  ../artifacts/avatar-router/src/sdk/cleanup-compat-doc.test.ts \
  ../artifacts/avatar-router/src/sdk/avatarrouter-bundle.test.ts
pnpm run typecheck
```

기존 29개 문서/배송 번들 검사가 통과했다. VM에서만 실행하던 검사는 유지하며 브라우저 전달 검증으로 보완한다.

## 현재 실행 결과: 부분 통과, 완료 아님

2026-11-11 실제 브라우저 실행 결과:

- **브라우저 HTTP 캐시 통과:** 캐시된 `0.9.0` 대체 조회와 재검증 후 `0.9.1` 조회 통과.
  캐시 유지 중 추가 원본 SDK 요청이 없었으며, 상태 GET은 인증을 요구했다.
- **CDN 재현 통과:** stale HIT의 `0.9.0`과 edge 제거 후 `0.9.1`에서 동일한 읽기 전용 조회 통과.
- **서비스 워커 구버전 유지 통과:** 원본 교체 후에도 `0.9.0`이 전달됐고,
  대체 경로는 6회 상태 조회를 수행했으며 금지된 동작은 없었다.
- **서비스 워커 최신 교체 실패:** 캐시 삭제 및 워커 내부 `cache: reload` 재검증 후에도
  새 iframe에서 `AvatarRouter.version === "0.9.0"`이었다.
  현재 검증기는 이 결과를 성공으로 간주하지 않고 `FAIL`로 표시한다.
  재검증 요청/응답, 실제 iframe controller 및 브라우저 HTTP 캐시 경로를 더 조사해야 한다.
- **메타데이터 없는 고정 파일 및 transitional 번들:** 준비됐으나 앞선 실패로 실제 브라우저
  실행까지 도달하지 못했다. 기존 VM 계약 검사와 혼동하지 않는다.
- 관찰된 조회에서 새 생성 버튼은 계속 잠겨 있었고 실제 제공자/토큰/미디어 생성은 없었다.
- 실패한 실행의 검증용 서비스 워커와 캐시는 제거했으며 다른 앱의 캐시는 건드리지 않았다.

첫 비로그인 검사는 미리보기 접속 쿠키까지 제거해 fixture에 도달하지 못했다.
테스트 쿠키만 만료시키도록 수정한 후 브라우저/CDN의 실제 401 검사가 통과했다.
iframe이 제거되면 해당 iframe에서 얻은 서비스 워커 등록 객체를 사용할 수 없는 문제도
확인해 persistent parent에서 등록하도록 수정했다. 이는 정리 계약 자체의 결함과 구별한다.

전체 브라우저/CDN 증거는 `generated-artifacts/sdk-cache-delivery/browser-cdn-report.json`,
최종 서비스 워커 실패 증거는 `generated-artifacts/sdk-cache-delivery/remaining-report.json`에 보관했다.
이 결과만으로 전체 작업의 완료나 운영 CDN/외부 앱 호환성을 선언하지 않는다.
