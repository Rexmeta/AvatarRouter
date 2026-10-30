# RoleplayBot 페르소나 기본 아바타 선택

## 전달

- PR: https://github.com/Rexmeta/RoleplayBot/pull/24
- 대상: `Rexmeta/RoleplayBot`의 `liveavatar`
- 확인한 기준 커밋: `7dfb583a315756a33aa0544569ad7136f8d07ee0`
- 변경 커밋: `79e4cf5bed99f7f670734358f3e63fb2fd4cbdb8`
- 재현 가능한 소스 diff: [patches/roleplaybot-stock-avatar-selection.patch](patches/roleplaybot-stock-avatar-selection.patch)

외부 저장소 변경은 위 PR에 있으며, 이 작업공간의 실행 중인 AvatarRouter 코드는
변경하지 않았다. PR 병합·배포·실제 공급자 호출은 실행하지 않았다.

## 동작

페르소나의 Live 초안에서 기본 아바타와 커스텀 자산을 별도로 선택한다.
기본 목록은 `/avatars`, 소유 자산은 `/avatar-assets`에서 읽으며, 서버가 로그인한
사용자의 프로젝트 연결로 선택을 재확인한다. 현재 기본 선택은 configured 상태의
Tavus `tavus-stock-lucy`만 허용한다.

새 값은 `kind: stock` + `avatarId`, 또는 `kind: custom` + UUID `assetId`로 저장한다.
기존 `kind` 없는 UUID 초안은 계속 읽으며, 이전 값을 일괄 변환하지 않는다.
두 ID를 섞거나 stock ID를 자산 UUID로 보내면 거부한다. 모든 값은 계속 draft다.

기존 로그인·시나리오 선택·이미지/비디오 fallback·명시적 비용 동의·소유권·종료/정리
방어는 유지한다. stock 선택에 커스텀 검증 패널을 표시하지 않으며, 선택하거나 저장해도
학습자 Live 대화나 유료 세션을 시작하지 않는다.

## 검증

외부 저장소 checkout에서 다음 회귀 테스트 **12개 파일 / 175개 테스트**가 통과했다.

```sh
pnpm exec vitest run \
  tests/server/personaLiveAvatar.test.ts \
  tests/server/personaAvatarDraftRoundTrip.test.ts \
  tests/server/personaAvatarCatalogRoutes.test.ts \
  tests/client/personaAvatarSettings.test.tsx \
  tests/server/personaAvatarOperations.test.ts \
  tests/server/adminAvatarTest.test.ts \
  tests/server/liveAvatarBridge.test.ts \
  tests/server/avatarProjectConnection.test.ts \
  tests/client/personaAvatarValidation.test.tsx \
  tests/client/personaAvatarCreation.test.tsx \
  tests/client/adminAvatarTest.test.tsx \
  tests/client/personaSwitchAvatar.test.ts
```

`pnpm exec tsc --noEmit`도 통과했다. upstream의 npm 의존성 배치와 맞추기 위해
`pnpm install --ignore-workspace --lockfile=false --shamefully-hoist`로 설치했다.
upstream manifest와 lockfile은 변경하지 않았다. 일반 pnpm 비호이스팅 배치에서는
기존 `server/vite.ts`의 미선언 직접 의존성 `nanoid`를 찾지 못했다.

추가 `pnpm exec vite build`는 기존 저장소에 없는 아래 이미지 4개 때문에 실패했다.
이 PR은 해당 이미지나 이를 참조하는 소개 화면을 변경하지 않는다.

- `attached_assets/intro-card-feedback.webp`
- `attached_assets/intro-card-emotion.webp`
- `attached_assets/intro-card-scenario.webp`
- `attached_assets/intro-card-persona.webp`

실제 공급자 호출을 하는 테스트, 유료 세션 생성, 이미지 업로드, 실사용자 브라우저
로그인 테스트는 수행하지 않았다. 저장 호환성은 mock storage round-trip, 선택 UI는
mock transport를 사용하는 컴포넌트 테스트로 검증했다.
