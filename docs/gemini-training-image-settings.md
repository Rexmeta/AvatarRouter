# Gemini 학습 이미지 연결

## 모델 오류 진단

아바타 자산 화면의 **모델 접근 진단**은 신뢰된 라우터 운영자만 실행할 수 있습니다.
현재 API 서버의 키로 이미지 생성 모델의 Google 메타데이터만 GET 조회하여 HTTP 상태와 실행 소스 버전을 표시합니다. 검사 모델은 조회하지 않습니다.
이미지 전송·콘텐츠 생성·아바타 생성·기존 실패 작업 재시도는 하지 않습니다.
메타데이터 HTTP 200은 실제 이미지 생성, 할당량 또는 Renderer Worker의 설정을 검증하지 않습니다.
직접 키가 없는 관리형 연결은 이 Google 진단을 실행하지 않습니다.

`models/gemini-…` 형태와 앞뒤 공백은 자동 정규화됩니다. 잘못된 명시 설정을 다른 모델로 대체하지 않습니다.
검사 모델 설정은 생성에 사용하지 않습니다. 잘못된 생성 모델 설정은 `TRAINING_IMAGE_AI_REGENERATION_MODEL_INVALID`로 표시합니다.
기존 `TRAINING_IMAGE_AI_MODEL_UNAVAILABLE` 기록의 단계·HTTP 상태는 복원하거나 추정하지 않습니다.
신규 이미지 생성 중 404는 `TRAINING_IMAGE_AI_REGENERATION_MODEL_UNAVAILABLE`로 표시합니다. 기존 검사 오류 기록은 변경하지 않습니다.
RoleplayX는 실패 응답의 `messageKo`와 `code`를 표시하고, 준비 단계 표시는
선택 필드 `trainingImageStage`를 먼저 사용한 뒤 기존 `stage`로 대체할 수 있습니다.
기존 `stage`는 제공자 생성·상태·삭제 단계 계약이므로 이미지 준비 오류에는 `unknown`이 유지됩니다.

RoleplayX는 기존 시드 이미지만 AvatarRouter로 전송합니다. 모든 신규 작업은 원본 기반 Gemini 이미지 생성 → 기본 파일 검증·제공자별 정규화 → 제공자 전달 순서입니다. 별도 Gemini 시드 검사·생성 후 AI 검증은 하지 않습니다.
키 설정이나 생성 요청 접수만으로 실제 아바타 생성 성공을 의미하지 않습니다.

## 직접 발급한 Gemini 키

라우터 프로젝트 운영자가 Replit **Tools → Secrets**에서 `GEMINI_API_KEY`를 등록합니다.
채팅, RoleplayX 설정, 프런트엔드 환경변수, 브라우저 저장소에 이 키를 넣지 마세요.
게시된 서비스는 **Production app secrets**에도 적용됐는지 확인하고 재게시하세요.
API와 Renderer Worker가 같은 설정으로 실행돼야 합니다.

- 직접 키가 있으면 Google Gemini API를 사용합니다. 기존 Replit 프록시에 직접 키를 전송하지 않습니다.
- 직접 키가 없으면 기존 Replit Gemini 연결을 유지합니다.
- 직접 키 오류가 발생해도 관리형 연결로 자동 과금 전환하지 않습니다.
- 관리형 연결로 복귀하려면 운영자가 직접 키 시크릿을 제거합니다.
- 화면의 “설정됨”은 설정 존재 확인이며, API 인증·할당량·실제 이미지 생성 검증이 아닙니다.

직접 연결의 기본 이미지 생성 모델은 `gemini-3.1-flash-image`입니다.
기존 관리형 연결의 모델은 그대로 유지합니다.
필요하면 일반 환경변수 `GEMINI_TRAINING_IMAGE_MODEL`로 모델 ID를 지정할 수 있습니다. 기존 `GEMINI_TRAINING_INSPECTION_MODEL`은 더 이상 생성의 의존성이 아닙니다.
모델 접근 가능 여부와 이미지 생성 비용·한도는 해당 계정에 따라 다릅니다.

### 모델 확인과 404 진단

Google 공식 모델 문서에는 `gemini-3.1-flash-image`가 이미지·텍스트 출력이 가능한 정식 모델로 등록되어 있습니다.
문서: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image
모델 이름을 추측해 `-preview`를 붙이거나 다른 유료 모델로 자동 변경하지 않습니다.
`GET /v1beta/models/{model}`의 성공은 모델 메타데이터 조회 성공일 뿐, `generateContent` 호출·이미지 생성·할당량·결제 검증이 아닙니다.
개발 환경의 조회 성공을 운영 Worker의 생성 성공으로 해석해서도 안 됩니다.

RoleplayX는 자산의 기존 `failure.code`, `messageKo`, `nextAction`을 표시할 수 있습니다.

| 코드 | 실패 단계 |
| --- | --- |
| `TRAINING_IMAGE_AI_INSPECTION_MODEL_UNAVAILABLE` | 과거 시드 검사 HTTP 404 기록. 신규 작업에서는 발생하지 않음 |
| `TRAINING_IMAGE_AI_REGENERATION_MODEL_UNAVAILABLE` | 이미지 재생성에서 HTTP 404 |
| `TRAINING_IMAGE_AI_VERIFICATION_MODEL_UNAVAILABLE` | 과거 최종 AI 검증 HTTP 404 기록. 신규 작업에서는 발생하지 않음 |

이 코드들은 모두 아바타 제공자 전송 전 실패이며 `creationOutcome: not_created`입니다.
기존 `TRAINING_IMAGE_AI_MODEL_UNAVAILABLE`도 계속 처리해야 합니다.
404만으로 모델 오타, 특정 계정 제한 또는 결제 부족을 확정하지 마세요.
운영 로그의 `service: training_image_ai`에서 `stage`, `model`, `source`, `transport`, `httpStatus`, `code`를 함께 확인하세요.
직접 연결은 Google 공식 API 주소와 `v1beta`를 명시적으로 고정하며, 실패해도 다른 계정·모델로 자동 전환하지 않습니다.

## 생성 순서와 실패

1. 원본 저장본은 변경하지 않습니다.
2. Gemini에 보낼 원본 참조용 사본은 1.5 MB 이하로 제한합니다.
3. 시드로 이미지를 한 번 생성합니다. Tavus Phoenix 4.5와 Anam의 구도·크기, 원본 얼굴 외형 보존을 프롬프트에 명시합니다. 별도 시드 검사 API 호출은 하지 않습니다.
4. 생성된 파일의 형식·크기를 검증하고 제공자 규격으로 정규화합니다. 얼굴·구도의 별도 AI 검증은 하지 않습니다.
5. 최종본을 비공개 저장소에 저장해 요청한 Tavus/Anam 생성에 전달합니다.
6. 생성 실패·콘텐츠 차단·파일 오류 시 원본을 대신 보내지 않습니다. 제공자 자체의 수락과 기존 동의 조건은 별도입니다.
7. `POST /api/v1/avatar-assets`의 HTTP 202는 접수입니다. `GET /api/v1/avatar-assets/{id}`를 조회해 `status: ready` 및 제공자 ID가 확인됐을 때만 `completionMessage`·`completionMessageKo`로 생성 완료를 알립니다. 처리 중·실패·정리 필요 상태에는 완료 메시지가 `null`입니다. 실제 라이브 재생 검증은 별도입니다. 기존 idempotency 재요청이나 이미 생성된 자산의 조회는 이미지를 다시 생성하지 않습니다.

RoleplayX가 받는 기존 자산 `failure` 응답은 Gemini 인증, 접근 권한, 할당량, 모델, 결제 필요, 서비스 오류, 콘텐츠 차단을 구분합니다.
한도 429만으로 잔액 부족을 확정하지 않습니다.
Gemini 오류의 HTTP 상태를 Tavus/Anam의 HTTP 상태인 것처럼 기록하지 않습니다.
보존하는 오류 코드·단계·계정 연결 종류 외에 키, 원본 이미지, 프롬프트, 원시 응답은 로그에 출력하지 않습니다.
제공자 전송 전 실패는 `creationOutcome: not_created`, 자동 재시도 불가로 표시합니다.
설정 수정 후 사용자가 다시 요청하면 기존의 안전한 재요청 규칙을 적용합니다. 생성 결과가 불확실한 유료 요청은 이 규칙으로 재시도하지 않습니다.
