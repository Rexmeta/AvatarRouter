# RoleplayX 페르소나 음성 목록 페이지 탐색

RoleplayX 페르소나의 **라이브 대화 음성**에서 **음성 더 보기**를 눌러 첫 페이지 밖의 음성도 선택할 수 있다. 다음 페이지는 기존 목록에 추가되며 성별 필터와 저장된 음성은 그대로 유지된다. 다음 페이지 요청이 실패하면 이전 목록을 유지하고 같은 페이지를 다시 요청할 수 있다.

AvatarRouter의 `/api/v1/voices` 응답이 지정하는 `X-Voice-Catalog-Next-Offset`을 사용한다. 페이지가 바이트 제한에 걸리면 1,000개보다 적을 수 있으므로 행 개수만 보고 마지막 페이지를 판단하지 않는다. RoleplayBot 서버가 오프셋의 진행, 페이지 크기, 전체 개수와의 일관성을 확인한 후 검증된 다음 오프셋만 편집 화면에 전달한다. 페이지당 최대 1,000개와 256 KiB 제한을 유지한다. 새 음성을 저장할 때도 같은 프로젝트에서 제공자, 음성 ID, 성별 및 사용 가능 여부를 다시 확인한다. 기존 운영자·관리자 로그인과 프로젝트 키의 `assets:read` 요구 사항은 바꾸지 않는다.

## 검토 및 적용 순서

[페이지 탐색 패치](patches/roleplaybot-voice-pagination.patch)는 RoleplayBot `main`의 `2c2c3a04b6989c1bf69472ec1409086201b5f070`에 [음성 장애 복구 패치](patches/roleplaybot-catalog-recovery.patch)를 적용한 상태를 기준으로 한다. 복구 패치는 얼굴과 음성 조회를 분리하므로 반드시 먼저 적용한다. 적용할 변경이나 복구 패치가 이미 병합되어 있다면 중복 적용하지 않는다.

외부 저장소 변경 승인 후 RoleplayBot 작업 사본에서 순서대로 적용한다. 각 패치는 적용하기 전에 현재 작업 사본과 호환되는지 확인한다.

```sh
git apply --check /path/to/AvatarRouter/docs/patches/roleplaybot-catalog-recovery.patch
git apply /path/to/AvatarRouter/docs/patches/roleplaybot-catalog-recovery.patch
git apply --check /path/to/AvatarRouter/docs/patches/roleplaybot-voice-pagination.patch
git apply /path/to/AvatarRouter/docs/patches/roleplaybot-voice-pagination.patch
```

승인 후 적용 환경에서는 통화를 시작하지 않고 관리자 편집 화면에서 **음성 더 보기**를 눌러 첫 페이지에 없던 음성을 선택하고, 테스트 페르소나를 저장한 뒤 다시 열어 같은 음성이 유지되는지 확인한다. AvatarRouter 배포판의 `/voices`가 페이지 헤더를 제공하지 않는 경우 RoleplayX는 호환을 위해 첫 페이지만 표시한다.

## 로컬 검증

- RoleplayBot 타입 검사 및 관련 테스트 183개, AvatarRouter 페이지 계약 테스트 2개를 통과했다.
- 잘못된 다음 페이지 헤더, 반복·범위 초과 오프셋, 다중 바이트 크기 제한, 권한 부족, 다음 페이지 실패와 재시도, 이후 페이지의 음성 저장을 검증했다.
- RoleplayBot 외부 저장소에 쓰거나 운영에 배포하지 않았으며 실제 통화를 시작하지 않았다.
