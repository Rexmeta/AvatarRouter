# RoleplayX 아바타 목록 503 복구

## 원인과 변경

AvatarRouter 운영 로그에서 스톡 얼굴과 프로젝트 에셋은 HTTP 200이었으나 새 음성 목록은 503이었다. 음성 성별 분류 테이블이 개발·운영 스키마에 적용되지 않았고, RoleplayX는 얼굴 목록 응답을 보내기 전에 음성 조회까지 기다리고 있었다.

RoleplayBot의 [검토용 패치](patches/roleplaybot-catalog-recovery.patch)는 `main`의 `2c2c3a04b6989c1bf69472ec1409086201b5f070`을 기준으로 했다. 얼굴은 기존 관리자 전용 경로에서, 음성은 별도 관리자 전용 경로에서 조회한다. 음성 장애나 지연은 얼굴 표시를 막지 않으며 음성만 다시 조회할 수 있다. 저장된 음성은 실패·빈 목록·성별 필터 변경으로 지워지지 않는다. 기본 음성 사용은 사용자가 명시적으로 선택한다. 신규 음성 저장과 실제 세션 시작 시 서버 검증은 유지된다.

AvatarRouter는 분류 저장소 오류에 대해 이전과 같이 `VOICE_CATALOG_UNAVAILABLE`을 반환한다. 내부 로그에는 읽기/쓰기 단계와 고정된 실패 분류만 기록한다. 쿼리, DB 메시지, 자격 증명은 기록하지 않는다.

## 적용 및 읽기 전용 확인

1. 개발 환경에서 기존 Drizzle `push`로 `voice_gender_overrides`를 적용하고 테이블의 존재를 확인했다. 이후 프로젝트의 기존 병합 후 설정 스크립트도 성공했다. 운영 DB를 직접 수정하지 않았다.
2. AvatarRouter 게시를 승인하고 실행할 때 개발→운영 스키마 차이에서 `voice_gender_overrides` 생성이 포함되는지 확인한다. 기존 데이터 덮어쓰기는 선택하지 않는다. 게시 후 관리형 운영 DB에서 `SELECT to_regclass('public.voice_gender_overrides') IS NOT NULL`로 존재 여부만 확인한다.
3. RoleplayBot 패치는 승인 후 검토·병합한다. 적용 직전 해당 저장소에서 `git apply --check /path/to/roleplaybot-catalog-recovery.patch`로 현재 `main`과의 호환성을 확인한다. AvatarRouter 쪽 변경을 병합해도 RoleplayBot 변경이 자동 반영되지는 않는다.
4. 게시 후 프로젝트의 `assets:read` 키로 `/api/v1/avatars`, `/api/v1/avatar-assets`, `/api/v1/voices`를 각각 읽기 전용으로 확인한다. 음성 응답이 200이어도 공급자별 `status`를 확인한다. RoleplayX에 로그인해 기본·맞춤 얼굴 목록과 별도의 음성 영역이 표시되는지 확인한다. 이 점검에 새 세션이나 유료 통화가 필요하지 않다.

## 검증

- AvatarRouter 전체 타입 검사 및 음성 카탈로그·운영자 권한·세션 진입 관련 테스트 통과.
- RoleplayBot 전체 타입 검사와 관련 테스트 176개 통과. 느린 음성 요청 및 503 뒤에도 얼굴이 표시되고, 음성 재조회가 얼굴 목록이나 저장된 음성을 바꾸지 않음을 검증했다.
- 외부 GitHub 변경, 운영 게시, 실제 유료 통화는 수행하지 않았다.
