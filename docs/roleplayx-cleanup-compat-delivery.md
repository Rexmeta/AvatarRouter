# RoleplayX 종료 화면 구버전 호환 안내

## 외부 저장소 변경

- 대상: [`Rexmeta/RoleplayBot`](https://github.com/Rexmeta/RoleplayBot), 사용자가 지정한 `main` 기준.
- 검토 요청: https://github.com/Rexmeta/RoleplayBot/pull/28
- 작업 브랜치: `fix/cleanup-compat-ended-screen`
- 기준 커밋: `6f05ed2` / 변경 커밋: `665c0b4`
- 재현용 변경본: [`patches/roleplaybot-cleanup-compat.patch`](patches/roleplaybot-cleanup-compat.patch)
- `main` 직접 변경, 병합, 운영 배포는 하지 않았다. 이 AvatarRouter 작업의 병합만으로 외부 앱 변경이 병합되거나 배포되지는 않는다.

최초 확인 시에는 외부 저장소 `main`에 연동이 없었으나, 사용자의 대상 브랜치 지정 이후 최신 `main`을 다시 가져온 결과 연동이 포함되어 있었다. 최신 코드를 기준으로 수정했다.

## 실제 적용 위치와 동작

- `client/src/lib/avatarCleanupCompat.ts`
  - AvatarRouter의 `managed-client-integration.md`에 있는 `refreshCleanupSafely` 예제를 타입을 붙여 적용했다.
  - 버전 문자열이 아니라 실제 `refreshCleanup` 메서드 존재 여부를 검사한다.
  - 메서드가 없으면 같은 세션의 인증된 상태 조회 콜백을 사용한다.
  - SDK/조회 연동 부재, 잘못된 응답, 다른 세션, 권한/네트워크 오류, 8초 초과는 `unknown`이다.
  - `rendererState === "closed"`와 `cleanupPending === false`가 함께 확인된 경우에만 `confirmed`이다.
- `client/src/components/chat/useAvatarCleanup.ts`
  - 종료 화면에서는 재생 클라이언트가 해제되므로 SDK 대신 `null`과 서버가 돌려준 기존 세션 ID를 전달한다.
  - 기존 `apiRequest`로 `GET /api/tavus/conversations/:id/session`만 실행한다.
  - 수동 조회 중 버튼을 비활성화하고 계정/대화/세션 변경, 화면 이탈, 새로운 종료 시도 이전의 결과를 폐기한다.
- `client/src/components/chat/TavusChatWindow.tsx`
  - 종료 요청 시 기존 결과를 무효화한다. 요청 시도 후 정리 조회를 실행한다.
  - `ending`, `ended`, `create_unknown` 화면에 정리 상태 및 수동 재확인 버튼을 표시한다.
  - 기존 `startedRef` 생성 차단을 해제하지 않는다. `unknown/pending`에서 새 생성은 열리지 않으며 `confirmed`도 재생/생성 동작을 일으키지 않는다.
- `client/src/components/chat/AvatarCleanupNotice.tsx`
  - 미확인/정리 중/해당 세션 정리 확인을 구별한다.
  - 미확인 시 SDK/상태 조회 연동 업데이트 안내를 표시한다.
  - 업데이트는 통화 종료 후 진행해야 하며, 새 연결이나 세션을 만들지 않는다고 안내한다.
  - 해당 세션의 정리 확인과 서버의 새 유료 생성 허용을 구별한다.
- `server/routes/tavus.ts`
  - 기존 로그인 및 서버 소유권 검사 경로를 유지했다.
  - 캐시 정책만 `private, no-store`로 강화했다.

로그인 방식, 사용자/tenant 매핑, 서버 전용 프로젝트 키, AvatarRouter 제공자 구현, 세션/토큰 발급 계약은 변경하지 않았다. 프로젝트 키나 제공자 연결 정보는 브라우저에 추가하지 않았다.

## 검증 결과

### 통과

외부 체크아웃에서 다음 6개 테스트 파일의 92개 검사가 통과했다:

```sh
./node_modules/.bin/vitest run \
  tests/client/avatarCleanupCompat.test.ts \
  tests/client/avatarCleanupNotice.test.tsx \
  tests/client/tavusCleanupScreen.test.tsx \
  tests/client/managedAvatarRoom.test.tsx \
  tests/server/tavusRoutes.test.ts \
  tests/server/tavusPipeline.test.ts \
  --exclude '**/node_modules/**' --exclude '**/dist/**' \
  --exclude '**/*.smoke.test.ts'
```

외부 체크아웃이 `generated-artifacts` 아래에 있어 기존 테스트 설정의 해당 디렉터리 제외를 명령행에서 대체했다.

검사 내용:

- 기능 목록/버전 없는 새 메서드, 구버전/클라이언트 없는 상태 GET, 업데이트 필요 안내.
- 종료 응답/로컬 종료를 정리 완료로 오인하지 않는 조건.
- 잘못된 세션/응답, 403·404·네트워크 오류, 8초 제한.
- 실제 종료 화면 연결과 재확인 버튼의 GET 전용 호출 및 생성 차단 유지.
- 조회 중 중복 클릭 방지, 계정·세션 변경과 새 종료 시도 전의 응답 폐기.
- 기존 공통 SDK의 한 번만 연결하기, SDK 로드 실패 시 서버 종료, 인증/소유권 경계.

전체 TypeScript 검사도 통과했다:

```sh
./node_modules/.bin/tsc --noEmit --incremental false
```

의존성 설치는 격리된 체크아웃에서 수행했다. 기존 `server/vite.ts`가 직접 의존성 선언 없이 사용하는 `nanoid`는 npm 호이스팅과 달리 pnpm의 격리 설치에서 보이지 않아 이미 설치된 `nanoid` 패키지를 로컬 `node_modules`에 링크한 후 검사했다. 외부 `package.json`이나 잠금파일은 변경하지 않았다.

변경 패치에 대해 `git diff --check`와 외부 작업 트리에서 역방향 `git apply --check --reverse`가 통과했다. 실제 안내 컴포넌트의 세 상태를 네트워크/제공자 없는 표시 전용 화면으로 확인했다. 외부 앱 전체의 로그인된 브라우저 검증은 아니다.

### 기존 문제로 완료하지 못한 검사

외부 전체 Vite 빌드는 `main`에서 참조하지만 Git에 없는 이미지 때문에 중단됐다. 확인된 예:

- `attached_assets/intro-card-persona.webp`
- `attached_assets/intro-card-emotion.webp`

두 경로 모두 기준 커밋에서 파일이 없는 것도 확인했다. 임시 이미지로 빌드를 통과시키거나 이 작업과 무관한 자산 변경을 추가하지 않았다. 이 문제와 안내의 다국어 연결은 별도 후속 작업으로 제안했다.

유료 세션, 제공자 미디어/마이크 통화, 운영 로그인, 운영 데이터 변경 및 배포는 실행하지 않았다.
