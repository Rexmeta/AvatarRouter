# Renderer Worker 진단 로그

실시간 아바타 연결에서 요청 접수, 공급자 생성, 영상 준비, 정리는 서로 다른 단계입니다.
`LIVE_CREATE_RECONCILIATION_REQUIRED`는 생성 결과가 불확실하다는 안전 차단 상태이며 최초 실패 원인은 아닙니다.
이 로그 보강은 과거에 누락된 예외를 복원하거나 기존 세션의 차단을 해제하지 않습니다.
운영 환경에는 업데이트를 게시한 뒤부터 적용됩니다.

## 조회 및 비교

운영 실행 로그에서 대상 `sessionId`로 검색한 다음 `Renderer diagnostic` 항목을 시간순으로 비교합니다.
`workerId`와 기본 로그의 `pid`로 워커를 구분합니다. 프로세스가 다르다는 사실만으로 재시작이나 인계를 원인으로 단정하지 않습니다.
성공 세션과 실패 세션의 마지막 성공 단계와 최초 실패 단계를 비교합니다.
영상 준비는 공급자 참가 대기 완료이며, 사용자의 실제 브라우저 영상·음성 재생 검증과는 별개입니다.

| 단계 | 확인할 내용 |
|---|---|
| `runtime_start` | 워커의 전체 시작 처리 |
| `room_create` | LiveKit 방 생성 |
| `rtc_connect` | 렌더러의 LiveKit 연결 |
| `provider_dispatch` | DB의 생성 전 상태 기록과 리스 확인 |
| `provider_create` | 공식 Tavus 플러그인의 시작 호출 |
| `provider_id_persist` | 반환된 공급자 대화 ID의 DB 저장 |
| `video_join` | 공급자 참가 대기 |
| `running_persist` | 실행 상태의 DB 기록 |
| `cleanup`, `runtime_stop` | 정리 흐름과 런타임 종료 |
| `agent_close`, `avatar_close`, `rtc_disconnect` | SDK 및 네이티브 종료 |
| `remote_cleanup`, `provider_end`, `room_cleanup` | 외부 대화 종료와 방 부재 확인 |
| `cleanup_persist` | 정리 결과의 DB 기록 |

각 단계는 `outcome=begin/success/failure`, `durationMs`, 진단 객체 생성 이후 `elapsedMs`를 기록합니다.
`success`는 해당 함수의 정상 반환이며 전체 세션 성공이나 정리 완료를 뜻하지 않습니다.
중첩 단계의 소요 시간을 합산하지 않습니다. `begin`만 남으면 중단·대기·프로세스 종료 가능성을 다른 기록과 함께 조사합니다.
재수거된 세션은 새 워커의 진단 객체를 사용하므로 `elapsedMs`는 세션 전체 수명이 아닙니다.

추가 이벤트:
- `session_claimed`: 신규 생성 허용 여부, 세션 시작 이후 대기 시간, 남은 TTL, 리스 길이.
- `lease_lost`: `deadline/ownership/watchdog/operation_failure` 사유와 당시 진행 중인 단계.
  `operation_failure`는 예외 후 로컬 소유권을 포기한 것이며 DB 리스 경쟁을 확인했다는 뜻은 아닙니다.
  `watchdog`는 로컬 리스 기한 또는 세션 TTL 도달을 포함합니다.
- `initialize_failed`, `operation_failed`, `lease_cleanup_failed`: 정제된 오류 분류.
- `cleanup_result`: 공급자 종료·방 부재 확인 여부와 생성 결과 불확실 여부.
  `creationUnknown=true`면 종료 함수가 정상 반환해도 새 유료 생성이 허용된다고 해석하지 않습니다.

## 보안 및 한계

- `errorClass`는 정해진 클래스 이름만, `httpStatus`는 유효한 숫자만 기록합니다.
- `transportCode`는 허용된 네트워크·DB·리스 코드만 기록합니다.
- API 키, 토큰, URL, 공급자 응답 본문, 원시 오류 메시지, 스택, SQL, 이미지·오디오 및 사용자 대화 내용은 기록하지 않습니다.
- SDK의 상세 디버그 로그는 활성화하지 않습니다.
- 로그 기록 실패는 예외 전달·대화 ID 저장·정리를 방해하지 않습니다.
- 진단만을 위해 유료 호출을 재시도하지 않으며, 생성/정리 및 운영자 권한 규칙은 변경하지 않습니다.
- 로그만으로 외부 생성 성공 여부나 실제 과금을 확정할 수 없습니다. 기존 공급자 기록과 정리 증거가 필요합니다.
- 로그 보존 기간 이후의 원인은 이 기능으로 복구할 수 없습니다.
