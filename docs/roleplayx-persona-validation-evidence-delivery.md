# 첫 프레임 시간 관측과 페르소나 검증 완료의 분리

- 검토 PR: https://github.com/Rexmeta/RoleplayBot/pull/33
- 기반 PR: https://github.com/Rexmeta/RoleplayBot/pull/32
- 소스: `77e634e53f24900f2ea6f994c213c0c4531e5247`
- 브랜치: `test/persona-validation-evidence`
- PR 생성 당시 기반 PR은 미병합이었다. 새 PR은 기반 브랜치를 대상으로 한 검사 전용 변경이다.
  어느 PR도 자동 병합·게시하지 않았다.

실제 PersonaAvatarValidationPanel, AvatarTestSessionView 및 관리자 테스트/미디어/대화 훅을
함께 실행하는 통합 검사 7개를 추가했다. 이 화면·훅·시간 카드는 mock하지 않았으며
API·로그인 사용자·LiveKit 전송·미디어 프레임만 오프라인 fixture다.

첫 프레임의 video-playing 전송만으로 validation/report 호출, onReported 콜백 또는
fixture 에셋의 validated 전환이 일어나지 않았다.
실제 프레임, 성공한 처리 턴, 오디오 재생 준비, 영상·청취의 두 수동 확인 및 별도 보고 버튼이
각각 유지됐다. 오디오 준비 상실 뒤에는 기존 증거와 확인이 해제됐다.
시간 보고와 에셋 검증의 오류도 별도 문구로 유지되며 실패만으로 종료·재생성을 요청하지 않았다.

관련 5개 파일의 검사 **47개 통과**. 외부 HTTP는 차단하고 loopback만 허용했다.
제품 코드는 변경하지 않았다. 실제 통화·제공자 생성·운영 변경·게시도 수행하지 않았다.
실제 제공자 영상/음성의 독립 인증을 주장하지 않으며 전체 앱의 기존 빌드 장애를 해결하거나
전체 빌드 성공으로 보고하지 않는다.

재현 명령과 범위는 PR의 `docs/persona-validation-evidence-tests.md`에 포함했다.
