import type { Session } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { fmtSec } from './bits';

export function SessionTiming({ session }: { session: Session }) {
  const { lang } = useI18n();
  const ko = lang === 'ko';
  const timing = session.timing;
  return <div className="space-y-1 text-xs" data-testid={`session-timing-${session.id}`}>
    <div>{ko ? '라우터 경과' : 'Router elapsed'}: {fmtSec(timing?.routerElapsedSeconds ?? session.durationSeconds)}</div>
    <div>{ko ? '준비 (보고 수신까지)' : 'Preparation (until report)'}: {timing?.preparationSeconds == null ? '—' : fmtSec(timing.preparationSeconds)}</div>
    <div>{ko ? '첫 영상 보고 이후' : 'Since first video report'}: {timing?.connectedSeconds == null ? '—' : fmtSec(timing.connectedSeconds)}</div>
    <div className="text-muted-foreground">{timing?.evidence === 'authenticated_client_report'
      ? (ko ? '인증된 클라이언트 보고 · 연속 재생/음성/청구 시간 아님' : 'Authenticated client report · not continuous playback, speech or billing')
      : (ko ? '영상 재생 보고 없음 · 과거 기록 추정 안 함' : 'No video report · historical playback not inferred')}</div>
    {timing?.clientVideoReportedAt && <div className="text-muted-foreground">{ko ? '최초 수신' : 'First receipt'}: {new Date(timing.clientVideoReportedAt).toLocaleString()}</div>}
  </div>;
}
