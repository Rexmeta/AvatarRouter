# RoleplayBot liveavatar 브랜치 연동 진단

## 확인된 원인

- 공개 AvatarRouter의 OpenAPI는 점검 시점에 **0.4.0**이었다. RoleplayBot의 커스텀 재생 검증 코드는 **0.5.0**의 `liveValidation`, 세션의 `avatarAssetId`·`purpose`, `POST /avatar-assets/{id}/live-validation`을 필요로 한다. 개발 코드 구현만으로 공개 API는 갱신되지 않는다.
- RoleplayBot `PersonaAvatarCatalog.normalize`는 연결을 항상 `activation: "draft"`로 저장한다. `personaAvatarCatalogSchema.runtimeAvailable`도 `false`로 고정되어 있고 `AvatarRouterAdapter.openSession`은 항상 거절한다. 관리자 재생 검증과 학습자 런타임은 별도 작업이다. 이 제한을 단순히 true로 바꾸면 안 된다.
- `/avatar-assets`는 프로젝트 소유 커스텀 자산만 반환한다. `/avatars`의 기본 Lucy는 자산 UUID가 아니므로 현재 RoleplayBot의 UUID 기반 페르소나 선택 목록에 넣을 수 없다. 기본 테스트는 기존 관리자 Lucy 테스트를 사용한다. 페르소나에서 기본 아바타를 선택하려면 RoleplayBot에 별도 stock 참조 타입을 추가해야 한다.
- Studio 개인 자산과 프로젝트 API 키의 자산은 다른 네임스페이스다. 같은 사람이 생성했더라도 자동 공유되지 않는다.
- RoleplayBot의 프로젝트 클라이언트는 상위 오류를 HTTP 번호로 축약하며, 생성 UI는 모든 POST 실패를 결과 불확실로 표시한다. 따라서 버전 미지원과 실제 결과 불확실을 구분하기 어렵다.

## 무료 연결 확인 개선

`GET /api/v1/auth/check`의 기존 필드는 유지하며 `integration`을 추가했다.

```json
{
  "integration": {
    "apiVersion": "0.5.0",
    "features": ["project_api_key", "owned_avatar_assets", "custom_live_validation", "client_playback_report"],
    "customLiveProviders": ["tavus"],
    "assetNamespace": "project",
    "stockAvatarId": "tavus-stock-lucy",
    "stockCatalogPath": "/avatars",
    "ownedAssetCatalogPath": "/avatar-assets"
  }
}
```

이 필드가 없는 이전 서버에서는 프로젝트 인증은 성공할 수 있지만 커스텀 생성·재생 검증은 지원 확인 전 차단해야 한다. 버전 번호만 비교하지 말고 명시된 feature와 provider를 확인한다. 기능 구현 정보는 작업자 생존, 공급자 이용권, 잔여 크레딧 또는 재생 성공 증명이 아니다.

## 적용 순서

1. AvatarRouter 최신 버전을 게시한 후 RoleplayBot에 설정된 **실제 Base URL**에서 `/auth/check`의 `integration`을 확인한다. 개발 URL을 운영 설정에 임의로 대입하지 않는다.
2. `assets:read`로 목록을 조회한다. 비어 있으면 API 키 프로젝트에서 생성한 자산인지 확인한다. Studio 개인 자산을 노출하거나 다른 프로젝트 자산을 복사하지 않는다.
3. 기본 Lucy는 별도 관리자 테스트에서 점검한다. 커스텀 생성은 Tavus 이용권·비용·이미지 전송 동의 후에만 실행한다. 실존 인물 동의는 별도 검토가 필요하다.
4. 커스텀 Tavus가 ready인 경우에만 관리자 검증을 진행한다. `/live-limits` 작업자·정리·예산 확인 → 명시적 유료 검증 세션 → 실제 영상·오디오 확인 → 재생 보고 → 종료·정리 확인 순이다.
5. 검증 성공을 페르소나의 학습자 Live 활성화로 취급하지 않는다. RoleplayBot의 실제 학습자 렌더러·기존 AI 오디오 연결·실패 대체 처리를 별도로 구현하고 확인해야 한다.

Anam 이미지 자산 생성과 Anam 커스텀 라이브 런타임은 별개다. 현재 지원되는 커스텀 라이브 공급자는 Tavus뿐이며 자동 대체하지 않는다.

이 진단을 위해 실제 이미지·오디오 전송이나 유료 아바타 세션은 실행하지 않았다.
