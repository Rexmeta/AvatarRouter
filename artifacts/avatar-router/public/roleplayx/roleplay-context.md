# RoleplayX → AvatarRouter 공통 페르소나·시나리오 전달

AvatarRouter 프로젝트 API 키와 기존 관리형 브라우저 클라이언트를 그대로 사용합니다.
RoleplayX 서버가 로그인 사용자·tenant·페르소나·시나리오 접근 권한을 확인한 뒤 요청하세요.
Anam/Tavus 키나 SDK를 RoleplayX에 추가하지 않습니다.
`GET /auth/check`의 `integration.features`에 `unified_roleplay_context`와 `unified_final_transcript`가 있는지 확인하면 해당 서버의 지원 여부를 알 수 있습니다.

## 세션 생성

```http
POST {AVATAR_ROUTER_BASE_URL}/sessions
Authorization: Bearer {AVATAR_ROUTER_PROJECT_API_KEY}
Content-Type: application/json
```

```json
{
  "providerId": "anam",
  "avatarId": "anam-persona-default",
  "mode": "live",
  "costConfirmed": true,
  "roleplay": {
    "persona": "당신은 신중하고 까다로운 구매 담당자입니다. 짧고 명확하게 말하고, 가격과 유지보수 조건을 확인하세요.",
    "scenario": "사용자는 영업 담당자입니다. 첫 미팅에서 교육 솔루션을 제안합니다. 예산은 월 100만원이며, 아직 계약하지 않았습니다. 목표는 조건을 확인하고 다음 미팅 여부를 결정하는 것입니다.",
    "language": "Korean",
    "greeting": "안녕하세요. 먼저 가격과 유지보수 조건을 설명해 주세요."
  }
}
```

- `persona`: 필수, 1–8,000자. 특성·말투·역할·행동 제약.
- `scenario`: 필수, 1–16,000자. 상황·사용자 역할·목표·공유 가능한 사실·이전 대화 요약.
- `language`: 선택, 2–80자. 원하는 대화 언어. Anam에서는 사용자 음성 인식 언어에도 적용됩니다.
- `greeting`: 선택, 1–1,000자. 첫 발화 문장. 생략하면 제공자가 인사말을 생성합니다.
- 같은 요청에서 `providerId: "tavus"`, `avatarId: "tavus-stock-lucy"`로 바꾸면 동일한 컨텍스트를 Tavus에 전달합니다. 기존 권한·재생 검증을 통과한 Tavus 커스텀 자산에는 그 자산의 ID를 사용합니다.
- `roleplay`가 있으면 `pipeline`을 생략할 수 있습니다. AvatarRouter가 `anam_full` 또는 `tavus_full`을 선택합니다. 명시적인 기존 pipeline 입력도 유지합니다.
- 공백만 있는 값, 외부 오디오 모드의 roleplay, `roleplay`와 `fullPipeline` 동시 전달은 거절합니다.
- 기존 Tavus `fullPipeline`의 `systemPrompt`, `context`, `greeting`, `languages`도 두 제공자에서 그대로 받을 수 있습니다. AvatarRouter가 Anam의 임시 설정으로 변환합니다. `voiceId`는 Tavus 전용이므로 Anam에는 전달하지 마세요.
- **외부 API 키/JWT 연동의 Anam 대화에는 `roleplay` 또는 `fullPipeline`이 필수입니다.** 둘 다 없으면 `ROLEPLAY_CONTEXT_REQUIRED`로 유료 생성 전에 차단합니다. 컨텍스트 없는 기본 페르소나로 조용히 시작하지 않습니다.
- 로그인한 플레이그라운드에서 의도적으로 컨텍스트 입력을 끈 경우에만 기존 저장된 Anam 페르소나를 그대로 테스트할 수 있습니다.

Tavus에서 쓰던 컨텍스트 형식의 Anam 요청 예시입니다. 제공자 SDK나 설정을 RoleplayX에 추가할 필요는 없습니다.

```json
{
  "providerId": "anam",
  "avatarId": "anam-persona-default",
  "mode": "live",
  "costConfirmed": true,
  "fullPipeline": {
    "systemPrompt": "당신은 한국어로 말하는 신중한 구매 담당자입니다. 역할을 유지하세요.",
    "context": "교육 솔루션 상담. 월 예산은 100만원이며 아직 계약하지 않았습니다.",
    "greeting": "가격과 유지보수 조건을 설명해 주세요.",
    "languages": ["ko"]
  }
}
```

세션 생성 뒤에는 종전과 동일하게 `/client-connection`과 관리형 클라이언트를 사용합니다.
Anam은 `roleplay.language`와 기존 `fullPipeline.languages`를 모두 사용자 인식용
`personaConfig.languageCode`로 변환하며 `voiceDetectionOptions.sttProvider=anam`을 명시합니다.
`ko`, `Korean`, `한국어`, `ko-KR`는 모두 한국어 인식으로 변환됩니다.
지원되는 ISO 코드·영문 언어명·지역 태그를 사용할 수 있으며, 제공자 설정을 앱에 추가할 필요는 없습니다.
명시한 언어가 지원되지 않으면 `ANAM_UNSUPPORTED_LANGUAGE`로 토큰 발급 전에 실패합니다.
Anam은 세션당 하나의 인식 언어를 사용하므로 서로 다른 여러 언어를 전달하면
`ANAM_MULTIPLE_INPUT_LANGUAGES`로 실패합니다. 같은 언어의 별칭은 중복 제거합니다.
언어를 생략하거나 빈 목록을 보내는 기존 요청은 조직 기본값을 유지합니다.
Tavus의 언어 처리나 저장된 공용 Anam 페르소나는 변경하지 않습니다.
이 설정은 STT 요청 계약이며, 실제 한국어 인식 정확성 검증을 대신하지 않습니다.
근거: [Anam 다국어 및 STT 지원 계약](https://anam.ai/docs/personas/voices/multilingual).

두 컨텍스트 형식 중 하나는 RoleplayX 서버가 **실제로 요청 본문에 포함**해야 합니다.
AvatarRouter는 전송받지 않은 RoleplayX 내부의 선택된 페르소나·시나리오를 추측하거나 복원하지 않습니다.
`GET /auth/check`의 `anam_full_context_compat`, `anam_integration_context_required`로 이 동작의 지원 여부를 확인합니다.

생성 후 세션 조회에서 `rendererState=running`을 확인하고,
`POST /sessions/{id}/client-connection`으로 공통 클라이언트에 연결 정보를 전달하세요.
기존 [관리형 클라이언트 가이드](./managed-client-integration.md)의 연결·종료 절차를 그대로 사용합니다.
`anam_full`에서는 Gemini Live 마이크·생성을 중지하고 Anam 한 곳만 대화를 생성해야 합니다.
`tavus_full`도 동일하게 공통 클라이언트의 `onAudioOwner` 콜백에서 애플리케이션 음성 엔진을 중지합니다.

## 공통 대화 기록

`GET /sessions/{id}/transcript`를 두 제공자에서 동일하게 사용합니다. `sessions:read`와 세션 소유권을 검사합니다.
`source`는 `anam` 또는 `tavus`, `status`는 `pending`, `unavailable`, `ready`입니다.
`ready`에만 `final: true`, `revision`, `messages: [{role: "user" | "assistant", text, timestamp}]`가 포함됩니다.
제공자가 종료와 전체 기록을 확정하기 전에는 최종 기록으로 승격하지 않습니다.
Anam의 제공자 세션 ID는 브라우저 입력이 아닌 서버가 발급한 정확한 세션 라벨로 확인합니다.

관리형 클라이언트의 선택적 `onMessages(messages)`는 두 제공자의 **임시 실시간 자막**을 같은
`[{id, role: "user" | "assistant", text}]` 모양으로 전달합니다. 이는 확정된 평가 자료가 아닙니다.
종료 후 공통 transcript API로 최종 기록을 조회하세요.

새 Anam 토큰은 대화 텍스트 보관을 켜고 영상 녹화는 끕니다. 제공자가 텍스트 보관을 허용하지 않는
Zero Data Retention 조직에서는 토큰 발급이 명시적으로 실패할 수 있습니다. 기록을 못 남기면서 성공한 척하지 않습니다.
보관이 꺼졌던 과거 세션의 기록을 복원하지는 못합니다. 기록은 제공자의 보관 기간에 의존하며,
AvatarRouter DB에 별도의 영구 대화 아카이브를 만드는 기능은 아닙니다.
플레이그라운드 및 세션 상세에서 동일 API의 최종 기록을 확인할 수 있습니다.

## 격리와 지식 자료

AvatarRouter는 서버에 등록된 Anam 페르소나를 **읽기만** 하여 아바타·음성·LLM·아바타 모델을 가져옵니다.
요청의 역할과 시나리오로 세션 전용 임시 페르소나를 구성하며 공용 페르소나를 수정하거나 새 영구 페르소나를 만들지 않습니다.
템플릿에 연결된 프롬프트·성격·음성 세부 튜닝·도구·지식 폴더는 자동 상속하지 않습니다.
반드시 적용할 행동 규칙은 `persona`에 포함하세요. 임시 페르소나도 기존과 같은 외형·음성·LLM을 사용하지만 세부 동작이 완전히 동일하다는 보장은 없습니다.

공식 [Knowledge setup](https://anam.ai/docs/personas/knowledge/setup)은 장기 보관 자료를 폴더로 관리하는 기능입니다.
성격·행동 지침이나 매 대화의 개인정보를 영구 지식 폴더에 업로드하지 않습니다.
이번 기능은 RAG 문서 업로드·폴더 연결 기능이 아닙니다.
시나리오 사실을 프롬프트에 전달한다고 지시문 공격 방어 또는 tenant 권한 검사가 대체되지는 않습니다.

Anam 컨텍스트는 대기 중 세션의 서버 DB에 임시 보관되고, 토큰 발급 후 해당 컨텍스트 필드는 제거됩니다.
공개 세션 응답에 프롬프트를 포함하지 않으며, Anam으로 전송되므로 제공자 보관 정책이 적용될 수 있습니다.
불필요한 개인정보·비밀·다른 tenant 자료를 보내지 마세요.
기존 백업이나 실패 후 조정 대기 레코드까지 즉시 삭제된다는 의미는 아닙니다.

## 실패·안전 동작

- `INVALID_SESSION_INPUT`: 누락·형식·길이 제한 오류.
- `INVALID_ROLEPLAY_CONTEXT`: 공백 필드.
- `INVALID_ROLEPLAY_PIPELINE`: 지원하지 않는 모드.
- `INVALID_PIPELINE_CONFIG`: 충돌하는 컨텍스트 입력 또는 제공자/모드 조합.
- `ROLEPLAY_CONTEXT_REQUIRED`: Anam 외부 연동에서 공통 컨텍스트를 보내지 않음. 유료 세션을 생성하지 않습니다.
- `ANAM_UNSUPPORTED_VOICE`: 다른 제공자의 voiceId를 Anam에 전달함. 서버 템플릿 음성을 사용하세요.
- `ANAM_TEMPLATE_UNAVAILABLE`: 서버 템플릿 조회 실패.
- `ANAM_TEMPLATE_INVALID`: 템플릿의 아바타·음성·호스팅 LLM 설정 누락.
- 기존 토큰 발급·용량·이전 세션 정리 오류는 그대로 적용됩니다.

템플릿 오류는 세션 조회에 실패로 나타납니다. 공용 페르소나로 조용히 대체하거나 자동 재시도하지 않습니다.
최대 120초 제한을 임시 페르소나에도 요청하며, 기존 서버 종료·정리 확인을 함께 유지합니다.
토큰 만료만으로 실행 중 대화가 종료됐다고 판정하지 않습니다.

## 검증 범위

입력 제한, 프롬프트 구성, 세션별 격리, 지식·도구 미상속, 단일 토큰 발급과 비공개 처리에 대한 로컬 테스트를 포함합니다.
2026-11-09 명시적 비용 동의 후 실제 검증을 시도했습니다. 템플릿 조회 권한과 임시 설정의 제공자 수락,
실제 연결 및 제공자 종료 시각을 확인했고, 제공자 세션 설정에 역할·시나리오·언어 지침·지정 인사말이 포함됨을 확인했습니다.
그러나 첫 시도의 검증 준비 지연과 두 번째 시도의 인증 오류로 대화 응답은 수집하지 못했습니다.
따라서 실제 응답의 역할 준수·한국어 발화·인사말·시나리오 반영·컨텍스트 누출 여부는 **미검증**입니다.
설정 수락이나 영상 재생을 대화 이해의 증거로 해석하지 마세요.
두 번째 시도에서 발견한 Anam 생성 경로의 비동기 인증 오류 처리는 수정하고 로컬 회귀 테스트로 확인했습니다.
내부 상세 기록은 저장소의 `docs/anam-roleplay-live-validation.md`를 참고하세요.
추가 실제 호출에는 새 비용 동의가 필요하며 RoleplayX 운영 연결은 여전히 별도 확인 대상입니다.
공통 컨텍스트 변환, 대화 기록 정규화·권한·세션 일치 검사, 관리형 클라이언트 연결 변경은
로컬 테스트로 확인합니다. 이번 구조 개선에서는 유료 세션을 새로 실행하지 않았으므로,
실제 응답의 컨텍스트 준수와 실운영 기록 수집을 검증 완료했다고 해석하지 마세요.
