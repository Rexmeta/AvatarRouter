# RoleplayX 관리자·페르소나 테스트 영상 시간 관측

## 검토할 변경

- Draft PR: https://github.com/Rexmeta/RoleplayBot/pull/32
- 브랜치: `feat/admin-video-timing`
- 기준 main: `dd7f65fecf61819950d7c53a31f6bdf36417ac14`
- 최종 소스: `4d4fb9a1fbe7f37ef916f2e9454bea6032e02d8f`
- 기존 실제 대화용 PR https://github.com/Rexmeta/RoleplayBot/pull/31 은 확인 당시 open/unmerged였다.
  새 PR은 그 기반 변경을 최신 main에 반영하고 사용량 부족 화면과 테스트를 보존한 통합 검토안이다.
  기존 PR을 닫거나 어느 PR도 자동 병합하지 않았다. 중복 병합 대신 새 통합 변경을 검토해야 한다.

## 구현 범위

관리자 stock, 관리자 Anam, 페르소나 custom validation의 별도 경로에 엄격한
`{ "event": "video_frame_presented" }` 프록시를 연결했다.
클라이언트 시각·기간·사용자·tenant·API 키 등 추가 필드는 거절한다.
기존 로그인, 관리자/운영자 역할, 서버 프로젝트 키와 사용자·tenant 컨텍스트를 유지한다.
보고 전후 정확한 세션 ID와 stock provider/avatar 또는 custom asset/purpose를 검증한다.

stock/custom은 프레임 콜백 또는 구형 브라우저의 진행하는 media time을 한 번 관측한다.
구독·토큰·DOM playing만으로는 보고하지 않는다. 동일 세션 연결 재시도는 보고를 재시도하지 않는다.
계정·연결 세대·세션이 달라지거나 정지/폴링 실패 상태면 늦은 보고를 차단한다.
Anam은 공통 ManagedAvatarRoom/SDK의 첫 영상 보고 옵션을 사용한다.

관리자 계약에서 optional timing을 보존하고 기존 공통 시간 카드를 표시한다.
서버의 준비 시간과 첫 보고 이후 경과 시간만 표시하며 과거 세션을 추정하지 않는다.
시간 보고 실패는 별도 경고이고 미디어 재생·세션 종료·새 생성으로 이어지지 않는다.
이 보고는 에셋의 live-validation 완료 보고와 별개이며 예산·cleanup을 변경하지 않는다.

## 확인한 것과 확인하지 않은 것

- 외부 HTTP 차단/loopback 허용 상태에서 관련 12개 파일의 검사 **203개 통과**.
- 권한·입력·세션/제공자/에셋 바인딩·서버 시간 보존·첫 프레임·중복·실패 비치명성을 fixture/API 계약으로 확인.
- 전체 타입 검사는 기존 `server/vite.ts`의 `nanoid` 누락으로 실패.
- 전체 Vite 빌드는 기존 `intro-card-*.webp` 이미지 4개 누락으로 실패.
- 전체 앱 빌드 또는 실제 브라우저/실시간 제공자 재생 검증이 통과했다고 주장하지 않는다.
- 유료 생성·실제 통화·제공자 생성·운영 데이터 변경·게시·PR 병합은 실행하지 않았다.

전체 빌드 장애는 기존 별도 수정 과제에 남겨 두었다.
운영 적용에는 검토·병합·빌드 장애 해결·별도 게시가 필요하다.
실제 첫 영상 시각 일치 검증은 별도 승인된 통화에서 수행해야 한다.
상세 계약은 RoleplayX PR의 `docs/session-video-timing.md`에 포함했다.
