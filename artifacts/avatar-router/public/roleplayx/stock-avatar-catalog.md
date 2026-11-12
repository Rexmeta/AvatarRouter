# 스톡 아바타 이미지 갤러리 연동

기존 목록은 요금제 조회가 아니라 고정된 Lucy 호환 항목이었습니다.
새 `/api/v1/avatars`는 Tavus `GET /v2/faces?face_type=system&verbose=true`를 페이지 끝까지 조회합니다.
완료 상태·시스템 스톡·`available_for_plan: true`인 항목만 선택 대상으로 공개합니다.
사용자 커스텀 얼굴은 이 공용 목록에 섞지 않습니다.

응답은 기존 배열 계약을 유지하고 선택적으로 다음 필드를 추가합니다.

```json
{
  "id": "tavus-stock-rExample",
  "providerId": "tavus",
  "name": "Provider stock name",
  "description": "Provider-listed stock avatar",
  "kind": "configured",
  "configured": true,
  "languages": [],
  "stock": true,
  "model": "phoenix-4.5",
  "thumbnailUrl": "https://cdn.replica.tavus.io/example.jpg",
  "previewVideoUrl": null
}
```

실제 반환된 ID를 사용하세요. 예시 ID를 생성 요청에 사용하지 마세요.
Lucy의 기존 `tavus-stock-lucy` ID는 호환성을 위해 유지합니다.
그 외 항목은 `tavus-stock-{faceId}` 네임스페이스이며 `/avatar-assets`의 소유 자산 UUID가 아닙니다.
API는 새 선택을 현재 카탈로그와 대조한 뒤 입장 제한·비용 확인·정리 차단을 그대로 적용합니다.
저장된 스톡 선택은 renderer와 Tavus full pipeline 모두에서 같은 얼굴로 전달되며 Lucy로 치환하지 않습니다.

캐시는 서버에서 5분간 유지하며 동일 요청을 합칩니다. 키가 변경되면 캐시를 다시 조회합니다.
목록 조회 실패는 `STOCK_CATALOG_UNAVAILABLE` 오류이며, 무료 티어라는 추측이나 가짜 단일 목록으로 대체하지 않습니다.
목록에서 사용 가능하다는 응답은 통화 성공·잔액·재생 검증을 의미하지 않습니다.

RoleplayX에서는 썸네일·이름·제공자·모델을 카드로 표시하고 이름 검색·모델 필터를 제공합니다.
목록 탐색·선택·페르소나 저장만으로 아바타 학습이나 유료 세션을 생성하지 않습니다.
저장한 항목이 사라져도 다른 얼굴로 자동 교체하지 않습니다.
기존 관리자 Lucy 진단은 별도 기본 연결 시험이며 모든 새 스톡의 재생 검증을 뜻하지 않습니다.

이번 계정 키의 읽기 전용 조회 결과는 157개 항목이었으며 실제 수량은 계정·제공자 응답에 따라 달라집니다.
AvatarRouter 운영 게시와 RoleplayX 변경 병합·게시가 모두 필요합니다.
