# RoleplayX 페르소나 오류에 실패 단계 표시

페르소나 설정에서 기본 얼굴, 맞춤 얼굴, 음성, 테스트 세션 등 실제로 실패한 조회를 구분한다. 새 음성 선택을 저장할 때도 선택이 유효하지 않거나 음성 조회가 실패하면 해당 단계를 표시한다. 테스트 사전 조회 오류는 테스트 화면에서 확인하고, 세션을 시작하지 않고 다시 조회할 수 있다.

RoleplayBot 서버가 실패한 요청의 단계를 정한다. AvatarRouter의 오류 코드와 HTTP 상태가 허용 목록과 일치할 때만 정해진 원인으로 변환한다. 알 수 없는 응답은 일반 안내로 처리하며 공급자 오류 원문, 설정 값, 토큰은 관리자 응답과 화면에 전달하지 않는다. 프로젝트 키 인증 거부도 RoleplayX 로그인 만료로 취급하지 않는다.

## 적용 순서

[RoleplayBot 검토용 패치](patches/roleplaybot-persona-errors.patch)는 RoleplayBot `main`의 `2c2c3a04b6989c1bf69472ec1409086201b5f070`에 기존 얼굴·음성 조회 분리와 음성 페이지 탐색 패치를 적용한 상태를 기준으로 한다. 이미 적용된 패치는 건너뛴다.

```sh
patch_dir=/path/to/AvatarRouter/docs/patches
for patch in roleplaybot-catalog-recovery.patch roleplaybot-voice-pagination.patch roleplaybot-persona-errors.patch; do
  git apply --check "$patch_dir/$patch" && git apply "$patch_dir/$patch" || break
done
```

## 검증 범위

- 별도의 깨끗한 RoleplayBot 작업 사본에서 세 패치를 순서대로 적용했다.
- 기존 얼굴·음성 조회, 저장 검증, 관리자 테스트를 포함한 관련 테스트 317개를 통과했다. 오류 검증은 합성 응답을 사용하는 읽기 요청과 거부되는 입력으로 수행했다. 원문이 숨겨지고, 음성 재조회가 이미 표시된 얼굴이나 저장된 선택을 바꾸지 않는 것을 확인했다.
- RoleplayBot `main`의 기존 직접 의존성 누락(`nanoid`) 때문에 타입 검사는 설치되어 있는 패키지를 임시로 연결해 통과시켰다. 의존성 파일은 변경하지 않았다.
- RoleplayBot 외부 저장소에 쓰거나 운영에 배포하지 않았고 실제 통화를 시작하지 않았다.
