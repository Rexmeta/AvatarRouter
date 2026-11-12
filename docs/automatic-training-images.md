# 커스텀 아바타 학습 이미지 자동 보정

## 요청한 제공자로 자동 전달

`providerId: tavus`는 Gemini 생성 이미지를 `POST https://tavusapi.com/v2/faces`의 `train_image_url`로 전송합니다. `providerId: anam`은 `POST https://api.anam.ai/v1/avatars`의 `imageUrl`로 전송합니다. Anam에는 JPEG를 지원하는 `imageProcessing: auto`를 사용하며 정확한 PNG 형식이 필요한 `preserve` 모드를 잘못 지정하지 않습니다. 요청 제공자를 임의로 바꾸거나 실패 시 다른 제공자로 재생성하지 않습니다.

참고한 [Tavus Create PAL](https://docs.tavus.io/api-reference/pals/create-pal)은 **이미 존재하는 `default_face_id`에 대화 동작을 설정하는 API**입니다. 이미지 학습 엔드포인트가 아닙니다. 얼굴 생성은 [Create Face](https://docs.tavus.io/api-reference/faces/create-face)로 수행하고, PAL은 이후 대화 시작 흐름에서 생성된 얼굴에 연결합니다. 커스텀 얼굴 생성 요청만으로 별도 PAL이나 통화를 만들지 않습니다.

```json
{ "imageAssetId": "원본-이미지-자산-ID", "providerId": "tavus", "personaId": "persona_001" }
```

위 요청을 `POST /api/v1/avatar-assets`로 보내면 별도 `costConfirmed`나 두 번째 승인 API 호출 없이 자동 작업을 접수합니다. 생성 요청 자체가 Gemini·제공자 비용을 승인한다는 기존 계약은 유지합니다. 명시적 `costConfirmed: false`, 이미지 사용 권리 누락, 권한·요금제 제한은 우회하지 않습니다.

HTTP 202로 받은 `id`를 사용해 `GET /api/v1/avatar-assets/{id}`를 조회합니다. 목록·단건 결과에는 `Cache-Control: private, no-store`를 적용합니다. `ready`에는 완료 메시지, `failed`에는 안전한 `failure`, `reconciliation_required`에는 결과 확인 필요 상태를 전달합니다. 결과가 불확실한 생성 POST는 자동 반복하지 않습니다.

## 처리 흐름

1. 기존 API로 원본 시드 이미지를 등록합니다. 원본 저장본·해시는 보존합니다.
2. `POST /api/v1/avatar-assets` 생성 요청을 접수하면 별도 라우터 운영자 승인 없이 작업을 등록합니다.
3. 제공자별 학습 사본을 만듭니다. Anam은 1152×1152 JPEG, Tavus는 비율을 보존하고 512px 이상·최대 1152×1536 범위의 JPEG로 정규화합니다. 왜곡·임의 얼굴 크롭 대신 필요 시 여백을 추가하고 4.5MB 이하로 제한합니다.
4. Gemini가 시드의 성인 단일 대상·얼굴 식별 가능 여부를 검사합니다. 불명확하거나 부적합한 시드는 실패 처리합니다.
5. 정상 구도를 포함한 모든 신규 생성 작업에서 **원본 시드**를 입력으로 Gemini 이미지를 한 번 새로 생성합니다. 제공자별 구도·크기를 명시하고 얼굴 외형을 보존하며, 성인 한 명·머리와 양쪽 어깨가 보이는 가슴 위 중심 구도·낮춘 팔·의복·중립 배경을 요청합니다. 단순 리사이즈만으로 대체하지 않습니다.
6. 결과를 다시 제공자 규격으로 정규화하고 원본과 얼굴 외형 일관성·학습 조건을 재검사합니다.
7. 통과한 비공개 학습 사본만 제공자에 전송합니다. Tavus의 `auto_fix_training_image: true`도 유지합니다.

직접 Gemini 키 사용 시 기본 모델은 검사 `gemini-2.5-flash`, 생성 `gemini-3.1-flash-image`입니다. 직접 키가 없을 때만 기존 Replit 관리형 연결을 사용합니다. 직접 키 오류 시 다른 계정으로 자동 전환하지 않습니다. 설정과 과금 구분은 `gemini-training-image-settings.md`를 참고하세요.
한 작업에서 검사 최대 2회·이미지 재생성 최대 1회이며 SDK 자동 재시도는 끕니다.
Gemini 검사도 외부 AI 처리 비용이 발생합니다. 사진의 성인 여부·얼굴 외형 검사는 모델 판단이지 신원 검증이나 제공자 수락 보장이 아닙니다.

## 요청과 승인

기존 `imageAssetId`, `providerId`, `personaId`, `voiceName`을 그대로 사용합니다.
생성 요청 자체가 잠재적 AI 보정·제공자 생성 비용을 승인합니다. `costConfirmed`는 선택적 호환 필드이며 명시적 `false`는 생성 거절로 존중합니다.
소유권·`assets:write`·기존 이미지 권리 확인·실존 인물 동의 기록 참조는 유지합니다.
새 실존 인물 소스는 `consentStatus: attested`로 응답합니다. 동의 진술을 `verified`로 위장하지 않습니다.
제공자가 요구하는 신원 확인·정책·요금제 제한은 우회하지 않습니다.

## 실패를 RoleplayX에 전달

`POST /api/v1/avatar-assets`의 HTTP 202는 접수일 뿐입니다. `GET /api/v1/avatar-assets/{id}`를 폴링하면 제공자가 생성을 확인한 `ready` 상태에만 `completionMessage`, `completionMessageKo`를 반환합니다. 다른 상태에서는 `null`이며 실패 시 아래 `failure`를 표시합니다. 생성 완료는 실제 라이브 재생 성공과 다릅니다.

기존 아바타 조회·seed-live 조회의 `failure`에 안전한 `code`, `messageKo`, `creationOutcome`, `nextAction`을 반환합니다.

| 코드 | 의미 |
|---|---|
| `TRAINING_IMAGE_AI_UNAVAILABLE` | Gemini 연결 설정 없음 |
| `TRAINING_IMAGE_PREPARATION_FAILED` | 로컬 변환·저장·서명 실패 |
| `TRAINING_IMAGE_INSPECTION_FAILED` | Gemini 조건 검사 실패 |
| `TRAINING_IMAGE_SUBJECT_UNSUPPORTED` | 성인 한 명이라는 조건을 확인하지 못함 |
| `TRAINING_IMAGE_IDENTITY_UNCERTAIN` | 원본 얼굴이 불명확하거나 보정 후 외형 불일치 |
| `TRAINING_IMAGE_REGENERATION_FAILED` | Gemini가 유효한 이미지를 반환하지 못함 |
| `TRAINING_IMAGE_FRAMING_UNRESOLVED` | 보정 후에도 학습 구도 부적합 |

이 단계의 실패는 `creationOutcome: not_created`이며 Tavus·Anam 생성 요청을 보내지 않습니다.
작업을 자동 반복하지 않습니다. 사용자가 명시적으로 같은 생성 요청을 다시 보내면 **제공자 전송 전의 로컬 실패만** 같은 자산으로 재준비할 수 있습니다.
제공자 전송 결과가 불확실하면 기존 `reconciliation_required` 차단과 중복 생성 방지를 유지합니다.
긴 AI 작업 중 워커 작업권을 잃으면 제공자 생성 요청을 보내지 않습니다.

원본·학습 사본·서명 URL·Gemini 결과 본문은 오류에 노출하지 않습니다.
학습 사본은 비공개 저장소에 유지하고 아바타 삭제 시 제거합니다.

## 적용 상태

개발 구현 및 외부 호출 없는 회귀 테스트를 완료했습니다.
실제 Gemini 이미지 재생성·제공자 생성·실제 재생 성공은 아직 검증하지 않았습니다.
운영 사이트에 적용하려면 API·Renderer Worker·웹을 새 소스로 게시해야 합니다.
