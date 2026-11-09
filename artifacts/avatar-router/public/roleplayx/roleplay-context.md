# RoleplayX → Anam 페르소나·시나리오 전달

AvatarRouter 프로젝트 API 키와 기존 관리형 브라우저 클라이언트를 그대로 사용합니다.
RoleplayX 서버가 로그인 사용자·tenant·페르소나·시나리오 접근 권한을 확인한 뒤 요청하세요.
Anam 키나 SDK를 RoleplayX에 추가하지 않습니다.
`GET /auth/check`의 `integration.features`에 `anam_roleplay_context`가 있는지 확인하면 운영 서버의 지원 여부를 알 수 있습니다.

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
  "pipeline": "anam_full",
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
- `language`: 선택, 2–80자. 원하는 발화 언어.
- `greeting`: 선택, 1–1,000자. 첫 발화 문장. 생략하면 Anam이 인사말을 생성합니다.
- 공백만 있는 값은 거절합니다. 현재 `roleplay`는 `anam_full`에서만 지원하며 다른 모드에서는 명시적으로 거절합니다.
- `roleplay`를 생략하면 기존 저장된 Anam 페르소나 동작을 유지합니다.

생성 후 세션 조회에서 `rendererState=running`을 확인하고,
`POST /sessions/{id}/client-connection`으로 공통 클라이언트에 연결 정보를 전달하세요.
기존 [관리형 클라이언트 가이드](./managed-client-integration.md)의 연결·종료 절차를 그대로 사용합니다.
`anam_full`에서는 Gemini Live 마이크·생성을 중지하고 Anam 한 곳만 대화를 생성해야 합니다.

## 격리와 지식 자료

AvatarRouter는 서버에 등록된 Anam 페르소나를 **읽기만** 하여 아바타·음성·LLM·아바타 모델을 가져옵니다.
요청의 역할과 시나리오로 세션 전용 임시 페르소나를 구성하며 공용 페르소나를 수정하거나 새 영구 페르소나를 만들지 않습니다.
템플릿에 연결된 프롬프트·성격·음성 세부 튜닝·도구·지식 폴더는 자동 상속하지 않습니다.
반드시 적용할 행동 규칙은 `persona`에 포함하세요. 임시 페르소나도 기존과 같은 외형·음성·LLM을 사용하지만 세부 동작이 완전히 동일하다는 보장은 없습니다.

공식 [Knowledge setup](https://anam.ai/docs/personas/knowledge/setup)은 장기 보관 자료를 폴더로 관리하는 기능입니다.
성격·행동 지침이나 매 대화의 개인정보를 영구 지식 폴더에 업로드하지 않습니다.
이번 기능은 RAG 문서 업로드·폴더 연결 기능이 아닙니다.
시나리오 사실을 프롬프트에 전달한다고 지시문 공격 방어 또는 tenant 권한 검사가 대체되지는 않습니다.

컨텍스트는 대기 중 세션의 서버 DB에 임시 보관되고, 토큰 발급 후 해당 컨텍스트 필드는 제거됩니다.
공개 세션 응답에 프롬프트를 포함하지 않으며, Anam으로 전송되므로 제공자 보관 정책이 적용될 수 있습니다.
불필요한 개인정보·비밀·다른 tenant 자료를 보내지 마세요.
기존 백업이나 실패 후 조정 대기 레코드까지 즉시 삭제된다는 의미는 아닙니다.

## 실패·안전 동작

- `INVALID_SESSION_INPUT`: 누락·형식·길이 제한 오류.
- `INVALID_ROLEPLAY_CONTEXT`: 공백 필드.
- `INVALID_ROLEPLAY_PIPELINE`: 지원하지 않는 모드.
- `ANAM_TEMPLATE_UNAVAILABLE`: 서버 템플릿 조회 실패.
- `ANAM_TEMPLATE_INVALID`: 템플릿의 아바타·음성·호스팅 LLM 설정 누락.
- 기존 토큰 발급·용량·이전 세션 정리 오류는 그대로 적용됩니다.

템플릿 오류는 세션 조회에 실패로 나타납니다. 공용 페르소나로 조용히 대체하거나 자동 재시도하지 않습니다.
최대 120초 제한을 임시 페르소나에도 요청하며, 기존 서버 종료·정리 확인을 함께 유지합니다.
토큰 만료만으로 실행 중 대화가 종료됐다고 판정하지 않습니다.

## 검증 범위

입력 제한, 프롬프트 구성, 세션별 격리, 지식·도구 미상속, 단일 토큰 발급과 비공개 처리에 대한 로컬 테스트를 포함합니다.
이번 변경으로 실제 Anam 대화나 유료 세션을 생성하지 않았습니다.
실제 응답의 역할 준수·한국어 발화·시나리오 반영과 RoleplayX 운영 연결은 별도 확인이 필요합니다.
