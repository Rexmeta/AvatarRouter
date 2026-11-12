# 커스텀 아바타 학습 이미지 자동 보정

## 처리 흐름

1. 기존 API로 원본 시드 이미지를 등록합니다. 원본 저장본·해시는 보존합니다.
2. `POST /api/v1/avatar-assets` 생성 요청을 접수하면 별도 라우터 운영자 승인 없이 작업을 등록합니다.
3. 제공자별 학습 사본을 만듭니다. Anam은 1152×1152 JPEG, Tavus는 비율을 보존하고 512px 이상·최대 1152×1536 범위의 JPEG로 정규화합니다. 왜곡·임의 얼굴 크롭 대신 필요 시 여백을 추가하고 4.5MB 이하로 제한합니다.
4. Gemini가 학습 구도를 검사합니다. 정상이라면 이미지 재생성은 하지 않습니다.
5. 구도·팔 자세 등이 부적합할 때만 **원본 시드**를 입력으로 Gemini 이미지를 한 번 재생성합니다. 얼굴 외형을 보존하고, 성인 한 명·머리와 양쪽 어깨가 보이는 가슴 위 중심 구도·낮춘 팔·의복·중립 배경을 요청합니다.
6. 결과를 다시 제공자 규격으로 정규화하고 원본과 얼굴 외형 일관성·학습 조건을 재검사합니다.
7. 통과한 비공개 학습 사본만 제공자에 전송합니다. Tavus의 `auto_fix_training_image: true`도 유지합니다.

Gemini 검사 기본 모델은 `gemini-3.8-flash`, 재생성은 `gemini-3-pro-image`입니다.
Replit AI Integrations를 사용하며 별도 Gemini 키 없이 Replit 크레딧으로 청구됩니다.
한 작업에서 검사 최대 2회·이미지 재생성 최대 1회이며 SDK 자동 재시도는 끕니다.
Gemini 검사도 외부 AI 처리 비용이 발생합니다. 사진의 성인 여부·얼굴 외형 검사는 모델 판단이지 신원 검증이나 제공자 수락 보장이 아닙니다.

## 요청과 승인

기존 `imageAssetId`, `providerId`, `personaId`, `voiceName`을 그대로 사용합니다.
생성 요청 자체가 잠재적 AI 보정·제공자 생성 비용을 승인합니다. `costConfirmed`는 선택적 호환 필드이며 명시적 `false`는 생성 거절로 존중합니다.
소유권·`assets:write`·기존 이미지 권리 확인·실존 인물 동의 기록 참조는 유지합니다.
새 실존 인물 소스는 `consentStatus: attested`로 응답합니다. 동의 진술을 `verified`로 위장하지 않습니다.
제공자가 요구하는 신원 확인·정책·요금제 제한은 우회하지 않습니다.

## 실패를 RoleplayX에 전달

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
