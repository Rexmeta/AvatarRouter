# RoleplayX 페르소나 시드 라이브 설정 — 구현 전달

## 소스와 적용 상태

- 사용자 확인 기준 브랜치: `Rexmeta/RoleplayBot`의 `main`.
- 기준 커밋: `6f05ed25d2bb26ef7a942dc5d6aba27d8d994ddf`.
- 구현 브랜치: `feat/persona-seed-live-options`.
- 구현 커밋: `da456d2ac99678f9dba90e0206e9f1940b341607`.
- 검토용 초안 PR: https://github.com/Rexmeta/RoleplayBot/pull/29
- **외부 RoleplayX의 실제 편집기·저장 코드에 연결했습니다. 운영 사이트에는 아직 적용하지 않았습니다.**
- `main` 직접 변경·병합·배포·운영 DB migration은 실행하지 않았습니다.

## 구현 내용

실제 `PersonaManager → PersonaAvatarSettings → PersonaSeedLivePanel`에 연결했습니다.
기본 이미지를 먼저 저장한 뒤 권리·외부 전송을 확인하여 시드로 등록하고,
별도 비용 확인 후에만 라이브 생성 요청을 보냅니다. 생성 이름은 페르소나 ID입니다.
Router가 제공자 학습 보정을 담당하며 원본 이미지는 변경하지 않습니다.

- 로그인·관리자/운영자 권한과 검증된 tenant/project별 작업 분리 유지.
- 현재 시드 ID·버전의 `live-options`만 조회.
- 대기·처리·실패·생성 결과 확인 필요·재생 검증 필요를 구분.
- 실패의 안전한 한국어 설명·코드·단계·제공자 HTTP 상태 표시.
- 미검증/실패 후보도 초안으로 저장 가능. 실제 대화는 최신 검증된 참조만 허용.
- 시드 변경 시 이전 seed-backed 연결 해제. 늦은 이전 이미지 응답 무시.
- 외부 POST 전 내구성 있는 기록과 PostgreSQL advisory lock으로 중복/불확실 생성 차단.
- 편집기 진입·일반 저장·상태 조회에서는 이미지 전송이나 유료 생성 금지.
- 기존 이미지/비디오/기본 아바타 namespace·시나리오·Gemini 기본 음성·평가 로직 유지.
- nullable `live_avatar_seed` JSONB migration 소스 추가. 운영 DB에는 실행하지 않음.

생성 접수와 재생 성공을 동일시하지 않습니다. 실제 대화는 기존의 명시적 엔진 선택을
사용하며 이번 변경으로 Gemini와 Tavus full을 동시에 실행하지 않습니다.

## 검증과 한계

외부 HTTP를 차단하고 모의 API/저장소/컴포넌트로 검증했습니다.

| 검증 | 결과 |
|---|---|
| 최초 관련 회귀 검증 7개 suite | 78개 통과 |
| 후속 저장·대화 변경 검증 4개 suite | 45개 통과, 위 검증과 일부 중복 |
| 최종 대화 참조 재확인 suite | 28개 통과, 위 검증과 일부 중복 |
| `git diff --check` | 통과 |
| 전체 TypeScript 검사 | 기존 `server/vite.ts`의 `nanoid` 직접 의존성 누락으로 실패 |
| 전체 빌드 | 기존 소개 이미지 `intro-card-feedback/persona/scenario/emotion.webp` 4개가 checkout에 없어 실패 |
| 실제 RoleplayX 운영 화면·영상·음성 | 검증하지 않음 |
| 이미지 전송·제공자 생성·유료 통화 | 실행하지 않음 |
| 운영 배포·운영 데이터 변경 | 실행하지 않음 |

누락된 파일과 의존성은 이 PR이 수정한 파일이 아니며, 전체 빌드 통과를 주장하지 않습니다.
PR은 이 한계를 명시한 초안으로 열었습니다. 운영 적용 전 기존 빌드 장애 해결,
PR 검토·병합 및 별도 승인된 게시가 필요합니다.

등록 POST 자체가 불확실한 경우 추정 ID로 복원하지 않고 운영자 확인이 필요합니다.
커스텀 재생 검증의 기존 LiveKit 경로는 그대로 유지합니다.
LiveKit 없는 별도 검증 경로를 이 작업에서 구현했다고 주장하지 않습니다.

외부 저장소의 상세 사용 가이드: `docs/persona-seed-live.md` (PR에 포함).
