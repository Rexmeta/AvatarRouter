# RoleplayX 페르소나 라이브 연결 — AvatarRouter API 0.5

## 범위와 상태

기존 Base URL + 프로젝트 API 키를 그대로 사용합니다. RoleplayX 로그인·시나리오 선택·대화 엔진·평가 엔진을 교체하지 않습니다.

이번 AvatarRouter 구현은 Tavus의 기존 Stock Face 실행 경로를 프로젝트 소유 Custom Face까지 확장합니다. Anam은 생성 API와 실행 API를 구분하며 커스텀 라이브 실행은 `LIVE_PROVIDER_UNSUPPORTED`로 거절합니다. LemonSlice·Simli 실행 어댑터는 이번 범위가 아닙니다.

코드 및 외부 호출 없는 테스트 완료는 실제 공급자의 재생 성공이 아닙니다. 실제 이미지 전송·생성·라이브 검증은 운영자의 별도 비용 승인 후 진행해야 합니다.

## 페르소나 관리 연동

RoleplayX에는 별도로 `avatarMode: image | video | live`와 라이브 설정 저장 기능이 필요합니다. 기존 이미지·비디오 필드를 재활용하거나 시나리오 관리자에 아바타 설정을 추가하지 않습니다.

1. RoleplayX 서버가 기존 로그인과 관리자/tenant 권한을 검증합니다.
2. 해당 조직의 프로젝트 키로 `GET /api/v1/avatar-assets`를 호출합니다.
3. `status=ready`는 **생성 완료**입니다. `liveValidation.runtimeSupported`는 실행 어댑터 지원 여부입니다.
4. 실제 사용 가능한 라이브 페르소나로 게시하려면 `liveValidation.status=validated`도 확인합니다.
5. 자산의 `id`를 페르소나의 `avatarAssetId`로 저장합니다. 클라이언트가 임의로 보낸 다른 자산 ID를 신뢰하지 않습니다.

Studio 개인 로그인으로 만든 자산은 다른 프로젝트 키에 자동 공유되지 않습니다. 자산 생성·조회·검증·실행은 같은 프로젝트 namespace에서 해야 합니다. 필요할 때만 검증된 사용자 컨텍스트를 사용하고 세션의 모든 호출에서 동일하게 유지합니다.

## 커스텀 아바타의 첫 재생 검증

운영자 승인 전에는 아래 세션 생성·오디오 전송을 실행하지 마세요. 검증도 유료입니다.

키에는 `assets:read`, `assets:write`, `sessions:create`, `sessions:read`, `sessions:connect`, `sessions:audio`, `sessions:end`가 필요합니다.

`GET /api/v1/avatar-assets/{id}`로 소유권과 현재 Provider ID를 조회한 뒤:

```json
{
  "providerId": "tavus",
  "avatarId": "<asset.providerAvatarId>",
  "avatarAssetId": "<asset.id>",
  "mode": "live",
  "purpose": "validation",
  "costConfirmed": true
}
```

위 본문을 `POST /api/v1/sessions`에 보냅니다. HTTP 201은 대기열 등록이며 영상 준비 완료가 아닙니다. 동일 자산을 재학습하지 않습니다.

1. 반환된 세션 ID로 조회하여 `rendererState=running`을 기다립니다.
2. `/sessions/{id}/connection`의 임시 구독 전용 토큰으로 LiveKit에 연결합니다.
3. 실제 원격 영상 프레임이 재생되는지 확인합니다. 참가자 접속이나 정지 이미지 표시만으로 성공 처리하지 않습니다.
4. `/sessions/{id}/audio`로 24 kHz mono PCM16 LE를 전송합니다(요청당 20 ms–5 s). 명령 완료와 실제 반환 소리를 확인합니다.
5. 같은 세션 소유자 컨텍스트로 아래 보고를 전송합니다.

`POST /api/v1/avatar-assets/{assetId}/live-validation`:

```json
{
  "sessionId": "<validation-session-id>",
  "videoObserved": true,
  "audioObserved": true
}
```

서버는 자산·프로젝트·세션 소유자·Provider ID 일치, 세션 purpose, 실행/유효기간/lease, Provider 생성 ID, 오디오 명령 완료를 검사합니다. 이후 `liveValidation.status=validated`, `method=client_playback_report`와 세션 ID·확인 시각을 저장합니다.

이 보고는 **권한 있는 클라이언트/운영자의 재생 확인 진술**입니다. 서버가 브라우저 화면이나 사람이 실제로 들었는지를 독립적으로 증명하지는 않습니다. RoleplayX 서버는 사용자가 임의로 성공 플래그를 보내 등록할 수 없도록 관리자 권한을 검사해야 합니다.

마지막으로 반드시 `/sessions/{id}/end`를 호출하고 상태를 조회하여 원격 정리 완료를 확인합니다. 정리 불명확 상태에서는 재생성을 시도하지 않습니다.

## 검증 이후 일반 대화

동일한 세션 생성 본문에서 `purpose`를 `conversation`으로 바꾸거나 생략합니다. 서버는 현재 Provider avatar ID에 대한 검증 기록이 없으면 `LIVE_VALIDATION_REQUIRED`로 차단합니다. ID가 변경되거나 자산이 준비 상태가 아니면 이전 검증을 재사용하지 않습니다.

매 대화마다 새 세션을 생성하되 기존 자산을 재학습하지 않습니다. 기존 RoleplayX AI 출력 음성을 AvatarRouter에 전달하고, 원래 음성 플레이어와 중복 재생하지 않도록 조정해야 합니다. 브라우저에 프로젝트 API 키를 전달하지 않습니다.

최대 120초·프로젝트/전체 예산·동시 실행 제한·작업자 lease·불명확 생성 격리·종료 재시도는 Stock과 Custom에 동일하게 적용됩니다. 사용 중이거나 원격 정리가 미확정인 자산은 삭제할 수 없습니다. 이 시간 예산은 공급자 크레딧 잔액이 아닙니다.

## 주요 오류

| 코드 | 조치 |
| --- | --- |
| LIVE_COST_CONFIRMATION_REQUIRED | 운영자가 유료 사용을 승인한 뒤에만 재요청 |
| LIVE_VALIDATION_REQUIRED | 먼저 별도의 검증 세션에서 실제 재생 확인 |
| LIVE_PROVIDER_UNSUPPORTED | 미지원 어댑터; 다른 Provider로 조용히 대체하지 않음 |
| LIVE_WORKER_UNAVAILABLE | 작업자 복구 전 유료 생성 차단 |
| LIVE_VALIDATION_AUDIO_REQUIRED | 연결만으로 부족; 오디오 명령 완료와 실제 소리 확인 필요 |
| LIVE_VALIDATION_SESSION_INVALID | 자산/세션/소유자/목적/유효기간 일치 확인 |
| AVATAR_ASSET_IN_USE | 세션 종료와 원격 정리 확인 후 삭제 |
| CONSENT_REVIEW_REQUIRED | 실제 인물의 동의 및 공급자 요건을 독립 검토 |

유료 생성·오디오 명령의 타임아웃을 자동 재전송하지 않습니다. 연결 확인 `/auth/check`에는 이 검증/과금 경로를 사용하지 않습니다.
