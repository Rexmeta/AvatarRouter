# RoleplayX 준비·첫 영상 보고 이후 시간 — 구현 전달

## 소스와 적용 상태

- 저장소: `Rexmeta/RoleplayBot`, 최신 `main` 기준.
- 기준 커밋: `e59becb` (변경 시작 시 origin/main).
- 구현 브랜치: `feat/session-video-timing`.
- 구현 커밋: `48dd51b558b6bec7deb19e1a67bb95b0ea786192`.
- 검토용 초안 PR: https://github.com/Rexmeta/RoleplayBot/pull/31
- **실제 RoleplayX 대화 프록시와 공통 클라이언트에 연결한 소스이며, 운영 게시·main 병합은 하지 않았습니다.**

## 구현 범위

`TavusChatWindow → ManagedAvatarRoom`의 Tavus/Anam full pipeline 경로에 연결했습니다.
기존 로그인·대화 소유권·프로젝트 및 서버 전용 API 키를 그대로 유지합니다.

- `POST /api/tavus/conversations/:runId/video-playing`은 서버에 바인딩된 ID만 사용해
  AvatarRouter `POST /sessions/:id/video-playing`으로 전달합니다.
- 로그인·동일 출처·소유자·프로젝트·세션/제공자/아바타 연결·`sessions:connect`를 확인합니다.
- 본문은 `{"event":"video_frame_presented"}`만 허용합니다. 시각·기간·tenant·임의 ID는 받지 않습니다.
- 공통 SDK의 실제 프레임 보고 콜백을 사용하며 연결 상태 문자열만으로 전송하지 않습니다.
- 중복 보고는 단일 Promise로 묶고, 보고 실패는 유료 세션 생성·종료·interrupt를 호출하지 않습니다.
- 기존 세션 GET의 `timing`을 보존해 라우터 경과/준비/첫 영상 보고 이후 시간을 구분합니다.
- `not_reported`·구버전·과거 기록은 `—`로 표시하고 추정하지 않습니다.
- 청구·발화·연속 재생 시간이 아니라 서버 보고 수신 시각 기준임을 안내합니다.
- 늦은 보고 응답으로 종료 상태를 활성화하지 않습니다. 예산·정리·평가 권한은 변경하지 않습니다.

기존 Daily와 관리자 테스트의 별도 경로에는 임의 프레임 보고를 추가하지 않았습니다.
새 연결은 이미 사용 중인 공통 SDK 경로를 따르며, 구형 경로·SDK는 보고 없음으로 남습니다.
상세 계약은 PR의 `docs/session-video-timing.md`와 이 저장소의 `docs/session-video-timing.md`를 참고하세요.

## 검증과 한계

| 항목 | 결과 |
| --- | --- |
| 서비스·HTTP 프록시·공통 클라이언트·시간 표시·대화 화면 fixture 검사 | 관련 104개 통과 |
| 전체 TypeScript 검사 | 기존 `server/vite.ts`의 `nanoid` 누락으로 실패 |
| 전체 Vite 빌드 | 기존 소개 카드 이미지 파일 누락으로 실패 |
| 변경 파일 검사 | 통과 |
| 실제 유료 통화·이미지/아바타 생성 | 실행하지 않음 |
| 운영 게시·운영 DB 변경·main 병합 | 실행하지 않음 |

운영 적용 전 기존 빌드 장애 해결, PR 검토·병합 및 별도 게시가 필요합니다.
AvatarRouter의 시간 컬럼/API/Worker와 새 호스팅 SDK가 먼저 반영되어야 합니다.
설정 확인·프록시 성공·fixture 통과를 실제 첫 영상 또는 운영 적용의 증거로 해석하지 마세요.
