import { useState } from 'react';
import {
  useCompareRendererDiagnostics, useListRendererDiagnosticSessions,
  type RendererDiagnosticComparison as Comparison, type RendererDiagnosticStage,
} from '@workspace/api-client-react';
import { Panel, fmtTime } from '@/components/bits';
import { useI18n } from '@/lib/i18n';

const stages = [
  'runtime_start', 'room_create', 'rtc_connect', 'provider_dispatch', 'provider_create',
  'provider_id_persist', 'video_join', 'running_persist', 'cleanup', 'runtime_stop',
  'remote_cleanup', 'cleanup_persist', 'provider_end', 'room_cleanup', 'agent_close',
  'avatar_close', 'rtc_disconnect',
];

export default function RendererDiagnosticComparison({ userId }: { userId: string }) {
  const { lang } = useI18n();
  const text = (en: string, ko: string) => lang === 'ko' ? ko : en;
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [selection, setSelection] = useState({ left: '', right: '' });
  const sessions = useListRendererDiagnosticSessions({ query: {
    queryKey: ['operator-diagnostic-sessions', userId], gcTime: 0, staleTime: 0,
    retry: false, refetchInterval: 10000,
  } });
  const query = useCompareRendererDiagnostics(selection, { query: {
    queryKey: ['operator-diagnostic-comparison', userId, selection],
    enabled: !!selection.left && !!selection.right, gcTime: 0, staleTime: 0,
    retry: false, refetchInterval: 10000,
  } });
  const status = (stage: RendererDiagnosticStage) => stage.outcome === 'success'
    ? text('Success', '성공') : stage.outcome === 'failure' ? text('Failure', '실패') : text('No completion record', '완료 기록 없음');
  const renderStage = (comparison: Comparison, name: string) => {
    const matches = comparison.attempts.flatMap(attempt => attempt.stages.filter(stage => stage.stage === name).map(stage => ({ attempt, stage })));
    if (!matches.length) return <span className="text-muted-foreground">{text('Not observed (not a failure)', '관측 기록 없음 (실패 아님)')}</span>;
    return matches.map(({ attempt, stage }) => (
      <div key={`${attempt.attemptId}-${stage.stageRunId}`} className="mb-2 last:mb-0">
        <strong className={stage.outcome === 'failure' ? 'text-destructive' : ''}>{status(stage)}</strong>
        <span className="ml-2 mono">{stage.durationMs === null ? '—' : `${stage.durationMs} ms`}</span>
        <div className="mono mt-1 text-[10px] text-muted-foreground">
          +{stage.elapsedMs} ms · {text('attempt', '시도')} {attempt.attemptId.slice(0, 8)}
        </div>
        {stage.beginMissing && <div className="text-[11px] text-[hsl(var(--warn))]">{text('Begin record missing', '시작 기록 누락')}</div>}
        {stage.errorClass && <div className="mono text-[11px]">{[stage.errorClass, stage.httpStatus, stage.transportCode].filter(Boolean).join(' · ')}</div>}
      </div>
    ));
  };

  return (
    <Panel title={text('Compare renderer stages', '렌더러 처리 단계 비교')} aside={<span className="mono text-[10px]">READ ONLY</span>}>
      <div className="space-y-4 p-4 md:p-5" data-testid="renderer-diagnostic-comparison">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {text('Safe diagnostic evidence is retained for 7 days. Older sessions, worker restarts, storage failures, or unexecuted branches may have missing records. Missing evidence does not prove failure. Comparison never creates a session or clears the paid-start block.',
            '허용된 진단 항목만 7일간 보존합니다. 과거 세션·워커 재시작·저장 실패·실행하지 않은 분기는 기록이 없을 수 있습니다. 기록 없음은 실패의 증거가 아닙니다. 비교는 세션을 생성하거나 유료 시작 차단을 해제하지 않습니다.')}
        </p>
        <form onSubmit={event => { event.preventDefault(); setSelection({ left: left.trim(), right: right.trim() }); }} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          {(['left', 'right'] as const).map((side, index) => (
            <label key={side} className="min-w-0 text-xs font-semibold">
              {text(`Session ${index + 1}`, `세션 ${index + 1}`)}
              <select aria-label={text(`Recent session ${index + 1}`, `최근 세션 ${index + 1}`)} value={side === 'left' ? left : right}
                onChange={event => (side === 'left' ? setLeft : setRight)(event.target.value)}
                className="mt-2 w-full rounded border border-input bg-background p-2 text-xs">
                <option value="">{text('Choose from the latest 100 live sessions', '최근 라이브 세션 100개 중 선택')}</option>
                {sessions.data?.map(session => <option key={session.id} value={session.id}>{session.status} · {session.rendererState} · {fmtTime(session.startedAt)} · {session.id}</option>)}
              </select>
              <input aria-label={text(`Session UUID ${index + 1}`, `세션 UUID ${index + 1}`)} required
                value={side === 'left' ? left : right} onChange={event => (side === 'left' ? setLeft : setRight)(event.target.value)}
                placeholder={text('Or enter a session UUID', '또는 세션 UUID 입력')} maxLength={36}
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                className="mono mt-2 w-full rounded border border-input bg-background p-2 text-xs" />
            </label>
          ))}
          <button type="submit" disabled={!left.trim() || !right.trim()} className="rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">
            {text('Compare', '비교')}
          </button>
        </form>
        {sessions.isLoading && <p role="status" className="text-xs">{text('Loading live sessions…', '라이브 세션 조회 중…')}</p>}
        {sessions.isError && <p role="alert" className="text-xs text-destructive">{text('Session list unavailable. Access may have changed.', '세션 목록을 조회할 수 없습니다. 접근 권한이 변경되었을 수 있습니다.')} <button onClick={() => sessions.refetch()} className="underline">{text('Retry', '재시도')}</button></p>}
        {!sessions.isLoading && sessions.data?.length === 0 && <p className="text-xs">{text('No live sessions yet.', '라이브 세션이 없습니다.')}</p>}
        {!!selection.left && !!selection.right && query.isLoading && <p role="status">{text('Loading diagnostic evidence…', '진단 기록 조회 중…')}</p>}
        {query.isError && <p role="alert" className="text-sm text-destructive">{text('Comparison unavailable. Verify both live session IDs and operator access; diagnostic storage may be unavailable.', '비교를 불러올 수 없습니다. 두 라이브 세션 ID와 운영자 권한을 확인하세요. 진단 저장소 장애일 수 있습니다.')} <button onClick={() => query.refetch()} className="underline">{text('Retry', '재시도')}</button></p>}
        {!query.isError && query.data && <>
          <div className="grid gap-3 md:grid-cols-2">
            {query.data.map((comparison, index) => (
              <div key={index} className="min-w-0 rounded border border-border p-3 text-xs" data-testid={`diagnostic-session-${index}`}>
                <strong>{text(`Session ${index + 1}`, `세션 ${index + 1}`)} · {comparison.session.status} / {comparison.session.rendererState}</strong>
                <div className="mono mt-1 break-all">{comparison.session.id}</div>
                <p className="mt-2 text-muted-foreground">{fmtTime(comparison.session.startedAt)} · {text('Observed', '조회')} {fmtTime(comparison.observedAt)}</p>
                <p className="mt-2">{comparison.recordCount} {text('records (best effort, not completeness proof)', '개 기록 (최선형 수집, 완전성 보장 아님)')}</p>
                {comparison.recordCount === 0 && <p className="mt-1 font-semibold">{text('No retained diagnostics. Historical logs cannot be reconstructed here.', '보존된 진단이 없습니다. 과거 로그를 이 화면에서 복원할 수 없습니다.')}</p>}
                {(comparison.recordsTruncated || comparison.invalidRecordCount > 0) && <p className="mt-1 text-[hsl(var(--warn))]">{text('Partial evidence', '일부 기록만 표시')} · {text('truncated', '조회 한도 초과')}: {String(comparison.recordsTruncated)} · {text('invalid records omitted', '잘못된 기록 제외')}: {comparison.invalidRecordCount}</p>}
                <p className="mt-2 font-semibold">{text('Browser playback: not verified by renderer diagnostics', '브라우저 재생: 렌더러 진단으로 검증되지 않음')}</p>
                {comparison.attempts.map(attempt => (
                  <details key={attempt.attemptId} className="mt-3 border-t border-border pt-2" open>
                    <summary className="cursor-pointer">{text('Worker attempt', '워커 시도')} {attempt.attemptId.slice(0, 8)} · {attempt.target}</summary>
                    <div className="mono mt-1 break-all text-[10px]">attempt: {attempt.attemptId}<br />worker: {attempt.workerId}</div>
                    {attempt.sequenceGaps && <p className="mt-1 text-[hsl(var(--warn))]">{text('Missing sequence records detected', '진단 순번 누락 감지')}</p>}
                    <ul className="mt-2 space-y-1">
                      {attempt.signals.map((signal, signalIndex) => (
                        <li key={signalIndex} className="mono break-words text-[10px]">+{signal.elapsedMs} ms · {signal.event}
                          {Object.entries(signal).filter(([key]) => !['event', 'elapsedMs'].includes(key)).map(([key, value]) => ` · ${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`).join('')}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{text('video_join means server-side video readiness, not visible playback. Times are relative to each worker attempt; nested stage durations overlap and must not be added.', 'video_join은 서버 측 영상 준비이며 실제 화면 재생이 아닙니다. 시간은 각 워커 시도 기준이며, 중첩된 단계의 소요 시간을 합산하면 안 됩니다.')}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs" data-testid="diagnostic-stage-table">
              <thead><tr className="border-b border-border"><th className="p-2">{text('Stage', '단계')}</th><th className="p-2">{text('Session 1', '세션 1')}</th><th className="p-2">{text('Session 2', '세션 2')}</th></tr></thead>
              <tbody>{stages.map(stage => <tr key={stage} className="border-b border-border align-top"><th className="mono p-2 font-normal">{stage}</th>{query.data.map((comparison, index) => <td key={index} className="p-2">{renderStage(comparison, stage)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>}
      </div>
    </Panel>
  );
}
