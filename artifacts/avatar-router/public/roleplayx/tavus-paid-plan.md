# RoleplayX: Tavus 유료 계정 연결

## 플랜과 실제 지원 범위

Tavus Developer API 계정의 유료 업그레이드와 AvatarRouter 프로젝트 API 키는
서로 다른 계층입니다. 업그레이드한 Tavus 프로젝트의 키가 AvatarRouter 서버에
설정되어 있어야 합니다. 동일 프로젝트의 기존 키가 유지됐다면 RoleplayX 키를
새로 발급할 필요가 없습니다. 계정이 다르거나 키가 폐기됐다면 운영자가 서버
시크릿만 갱신해야 합니다. Tavus 키를 RoleplayX나 브라우저로 전달하지 마세요.

공식 기능 출처: https://www.tavus.io/pricing

공식 페이지는 전체 음성·영상 대화 파이프라인, 언어 지원, 커스텀 얼굴,
대화 기록 등의 기능을 설명하지만, 가격 페이지의 플랜 표와 검색 결과는
변경되거나 서로 다를 수 있습니다. `$59`라는 결제 금액만으로 포함 분량,
동시 접속 수, 추가 요율, 모든 기능의 사용 권한을 하드코딩하지 않습니다.
실제 구독과 남은 분량은 Tavus Developer 대시보드의 해당 프로젝트에서 확인하세요.
PALs 소비자 구독과 Developer API 구독을 혼동하지 마세요.

| 기능 | AvatarRouter 지원과 조건 |
|---|---|
| 음성·영상 대화 | `tavus_full`: Tavus가 대화·음성·영상, Daily가 실시간 연결 담당 |
| 페르소나·시나리오 | `roleplay` 컨텍스트를 세션별 PAL로 격리 |
| 음성 선택 | 기존 `fullPipeline.voiceId` 지원. 실제 Tavus에서 허용된 ID만 사용 |
| 기본 얼굴 | `tavus-stock-lucy`, 학습·업로드 불필요 |
| 커스텀 얼굴 | 기존 소유 asset의 준비·동의·재생 검증 필요. 결제가 이를 자동 승인하지 않음 |
| 최종 기록 | 기존 transcript API. 준비 지연·미제공·생성 실패를 구분 |
| Gemini 음성 유지 | 별도의 `external_audio` 모드, 서버 LiveKit 설정 필요 |
| RAG·툴·메모리·녹화 | 제공자 기능 목록이 라우터 구현 보장은 아님. 이 안내로 활성화하지 않음 |

## Base URL + 프로젝트 API 키로 연결

기존 RoleplayX 로그인·tenant 검증을 유지하고 서버에서 호출하세요.
Base URL은 AvatarRouter `/api/v1`까지 포함합니다.

1. `GET /auth/check`: 기존 권한 및 `tavus_full_pipeline` 기능 확인.
2. `GET /live-limits?providerId=tavus&pipeline=tavus_full`: 무료 사전 확인.
   `creationAllowed=true`인지 확인. 이는 라우터 설정·워커·예산·정리 상태이며,
   Tavus 잔액이나 결제 성공을 검증하지는 않습니다.
3. 사용자의 명시적 시작·비용 동의 후에만 `POST /sessions`.

생성 본문 예시(이 문서는 요청을 실행하지 않습니다):

```json
{
  "providerId": "tavus",
  "avatarId": "tavus-stock-lucy",
  "mode": "live",
  "costConfirmed": true,
  "roleplay": {
    "persona": "한국어로 대화하는 고객. 예산과 도입 효과를 꼼꼼히 확인합니다.",
    "scenario": "학습자가 영업 담당자로서 첫 제품 상담을 진행합니다.",
    "language": "Korean",
    "greeting": "안녕하세요. 제품 도입 비용이 궁금합니다."
  }
}
```

`roleplay`를 보내고 `pipeline`을 생략하면 서버가 `tavus_full`을 선택합니다.
`roleplay`와 `fullPipeline`은 동시에 보내지 마세요.
음성을 지정하려면 기존 [full pipeline 계약](tavus-full-pipeline.md)의
`fullPipeline` 형식을 사용하세요.

같은 세션을 조회해 실제 `running` 상태와 종료 요청 여부를 확인한 후,
기존 연결 계약대로 미디어에 접속하세요. 접수 성공은 연결 성공이 아닙니다.
full pipeline은 LiveKit이 아닌 Daily 연결입니다. 기존 Router 연결 SDK를
사용하는 앱은 같은 연결 어댑터를 유지하세요.

## 음성 중복·비용·실패 처리

- full pipeline 시작 전 Gemini Live의 마이크 전송과 응답 재생을 중지합니다.
- 영상과 음성은 동일한 Tavus 연결에서 함께 재생합니다.
- 일반 끼어들기에 `/end`나 renderer `/interrupt`를 호출하지 않습니다.
- 시작 요청의 자동 재시도·실패 시 다른 제공자로 유료 자동 전환을 금지합니다.
- `failure.providerHttpStatus=402`는 결제/사용 권한 확인 대상입니다.
  업그레이드 전 실패를 숨기거나 자동 재시도하지 말고, 새 명시적 시도에서 새 결과를 표시하세요.
- 403은 크레딧 부족으로 단정하지 않습니다.
- cleanupPending은 결제 업그레이드와 별개입니다. 미확인 생성 차단은 우회하지 않습니다.
- 라우터는 기존 120초 세션, tenant 일일 예산, 전체 일일 예산, 최근 시도 제한,
  서비스 동시 생성 제한을 유지합니다. Tavus 포함 분량이나 잔액과는 별개입니다.
- 이 변경은 계정의 업그레이드 반영 여부나 실제 통화 성공을 입증하지 않습니다.

자세한 오류 전달: [provider-failures.md](provider-failures.md)
