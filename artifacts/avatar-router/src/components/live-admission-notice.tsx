import type { LiveLimits } from '@workspace/api-client-react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function LiveAdmissionNotice({ limits }: {limits: LiveLimits | undefined}) {
  const { lang } = useI18n();
  if (limits?.creationAllowed !== false) return null;
  const ko = lang === 'ko';
  const reasons = limits.blockingReasons ?? [];
  const actions: Record<string, [string,string]> = {
    LIVE_CLEANUP_REQUIRED: [
      'An operator must verify the previous provider creation and termination. The blocker may be outside this workspace. Replacing keys or creating another workspace will not clear it.',
      '운영자가 이전 제공자 세션의 생성·종료 결과를 확인해야 합니다. 다른 워크스페이스의 미정리 세션도 서비스 전체 연결을 차단합니다. API 키 교체나 새 공간 생성으로 해제되지 않습니다.',
    ],
    LIVE_CAPACITY_REACHED: ['Another live session occupies service capacity. Wait until its termination is confirmed.','다른 라이브 세션이 서비스 연결 용량을 사용 중입니다. 종료가 확인될 때까지 기다리세요.'],
    LIVE_WORKER_UNAVAILABLE: ['The renderer is not ready. An operator must restore its heartbeat before starting.','렌더러 워커가 준비되지 않았습니다. 운영자가 실행·상태 갱신을 복구해야 합니다.'],
    LIVE_NOT_CONFIGURED: ['AvatarRouter operator credentials are incomplete. External apps do not need provider keys.','AvatarRouter 운영 서버의 제공자 설정이 미완료입니다. 외부 앱에 제공자 키를 추가할 필요는 없습니다.'],
    LIVE_USER_DAILY_BUDGET: ['The project router budget cannot reserve another full session. This is not a Tavus balance or free-plan error.','프로젝트의 라우터 시간 예산으로 다음 세션 전체 시간을 예약할 수 없습니다. Tavus 잔액 소진이나 무료 요금제 오류가 아닙니다.'],
    LIVE_GLOBAL_DAILY_BUDGET: ['The service router budget cannot reserve another full session. This is not a Tavus balance or free-plan error.','서비스 전체의 라우터 시간 예산으로 다음 세션 전체 시간을 예약할 수 없습니다. Tavus 잔액 소진이나 무료 요금제 오류가 아닙니다.'],
    LIVE_USER_QUOTA_REACHED: ['Five attempts have been made within one hour. Wait for that window to pass.','최근 1시간에 5회 시도했습니다. 제한 시간이 지난 후 상태를 다시 확인하세요.'],
  };
  return <div className="console-note console-warning mb-6 flex gap-3" role="alert" data-testid="notice-live-admission">
    <AlertTriangle size={18} className="shrink-0"/>
    <div><strong>{ko ? '현재 라이브 테스트·사용을 시작할 수 없습니다' : 'Live testing and use are currently blocked'}</strong>
      <ul className="mt-2 space-y-2">{reasons.map(reason=><li key={reason}><p className="text-sm">{actions[reason]?.[ko ? 1 : 0] ?? reason}</p><code className="text-xs opacity-70">{reason}</code></li>)}</ul>
      <p className="mt-3 text-xs">{ko ? '상태 확인은 무료이며, 새 유료 세션 생성이나 기존 차단 해제를 실행하지 않습니다.' : 'This read-only check is free. It creates no paid session and clears no safety block.'}</p>
    </div>
  </div>;
}
