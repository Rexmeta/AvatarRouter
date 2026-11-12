import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetWorkspaceBudget, useUpdateWorkspaceBudget, useResetWorkspaceBudget,
  getGetWorkspaceBudgetQueryKey, getGetDeveloperWorkspaceQueryKey, getGetLiveLimitsQueryKey,
  type WorkspaceBudget, type BudgetScope,
} from '@workspace/api-client-react';
import { AlertTriangle, RotateCcw, Save } from 'lucide-react';
import { ErrorState, Panel, Skel, errMsg, fmtSec, fmtTime } from '@/components/bits';
import { useI18n } from '@/lib/i18n';
import { minutesToSeconds, validateBudget } from '@/lib/workspace-budget-input';

type Scope = 'project' | 'service';

const httpStatus = (e: unknown) => (e as { status?: number })?.status;

function Meter({ s }: { s: BudgetScope }) {
  const pct = s.dailySeconds > 0 ? Math.min(100, ((s.usedSeconds + (s.reservedSeconds ?? 0)) / s.dailySeconds) * 100) : 100;
  return <div className="mt-3 h-1.5 w-full overflow-hidden rounded-sm bg-muted"><div className="h-full origin-left bg-primary transition-transform duration-500" style={{ transform: `scaleX(${pct / 100})` }}/></div>;
}

function ScopeCard({ scope, s, editable, budget, projectId, userId, onDone }: {
  scope: Scope; s: BudgetScope; editable: boolean; budget: WorkspaceBudget; projectId: string; userId: string;
  onDone: (b: WorkspaceBudget, msg: string) => void;
}) {
  const { lang } = useI18n();
  const t = (en: string, ko: string) => lang === 'ko' ? ko : en;
  const qc = useQueryClient();
  const update = useUpdateWorkspaceBudget();
  const reset = useResetWorkspaceBudget();
  const inflight = useRef(false);
  const ctx = useRef({ projectId, userId });
  ctx.current = { projectId, userId };
  const [minutes, setMinutes] = useState(String(Math.floor(s.dailySeconds / 60)));
  const [dirty, setDirty] = useState(false);
  const [costOk, setCostOk] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetOk, setResetOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'reset'>(null);
  const lastRev = useRef(s.revision);

  // Only re-seed form when revision actually changes; clear confirmations then.
  useEffect(() => {
    if (lastRev.current === s.revision) return;
    lastRev.current = s.revision;
    setMinutes(String(Math.floor(s.dailySeconds / 60)));
    setDirty(false); setCostOk(false); setResetOk(false); setResetOpen(false);
  }, [s.revision, s.dailySeconds]);

  const seconds = minutesToSeconds(minutes);
  const invalid = validateBudget(scope, seconds, budget);
  const disabled = !editable || busy !== null;

  const settle = async (b: WorkspaceBudget | null, msg: string, sent: { projectId: string; userId: string }) => {
    if (sent.projectId !== ctx.current.projectId || sent.userId !== ctx.current.userId) return; // stale account/project
    if (b) qc.setQueryData([...getGetWorkspaceBudgetQueryKey(sent.projectId), sent.userId], b);
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetWorkspaceBudgetQueryKey(sent.projectId) }),
      qc.invalidateQueries({ queryKey: getGetDeveloperWorkspaceQueryKey(sent.projectId) }),
      qc.invalidateQueries({ queryKey: getGetLiveLimitsQueryKey() }),
    ]);
    if (b) onDone(b, msg);
  };
  const fail = (e: unknown, sent: { projectId: string; userId: string }) => {
    if (sent.projectId !== ctx.current.projectId || sent.userId !== ctx.current.userId) return;
    const conflict = httpStatus(e) === 409 && (e as { data?: { code?: string } })?.data?.code === 'BUDGET_REVISION_CHANGED';
    setError(conflict ? t('Budget changed elsewhere (revision conflict). Latest values reloaded; review and confirm again. ', '다른 곳에서 예산이 변경되었습니다(리비전 충돌). 최신 값을 불러왔으니 다시 확인하세요. ') + errMsg(e) : errMsg(e));
    setCostOk(false); setResetOk(false);
    if (conflict) qc.invalidateQueries({ queryKey: getGetWorkspaceBudgetQueryKey(sent.projectId) });
  };

  const save = async () => {
    if (inflight.current || !editable || !costOk || invalid || seconds === null) return;
    inflight.current = true; setBusy('save'); setError(null);
    const sent = { ...ctx.current };
    try {
      const b = await update.mutateAsync({ projectId: sent.projectId, data: { scope, dailySeconds: seconds, revision: s.revision, costConfirmed: true } });
      setDirty(false); setCostOk(false);
      await settle(b, t(`Saved: ${fmtSec(b[scope].dailySeconds)} per day (revision ${b[scope].revision}).`, `저장됨: 하루 ${fmtSec(b[scope].dailySeconds)} (리비전 ${b[scope].revision}).`), sent);
    } catch (e) { fail(e, sent); } finally { inflight.current = false; setBusy(null); }
  };
  const doReset = async () => {
    if (inflight.current || !editable || !resetOk) return;
    inflight.current = true; setBusy('reset'); setError(null);
    const sent = { ...ctx.current };
    try {
      const b = await reset.mutateAsync({ projectId: sent.projectId, data: { scope, revision: s.revision, confirmed: true } });
      setResetOpen(false); setResetOk(false);
      await settle(b, t(`Counter reset: used ${fmtSec(b[scope].usedSeconds)}, remaining ${fmtSec(b[scope].remainingSeconds)}.`, `카운터 초기화됨: 사용 ${fmtSec(b[scope].usedSeconds)}, 잔여 ${fmtSec(b[scope].remainingSeconds)}.`), sent);
    } catch (e) { fail(e, sent); } finally { inflight.current = false; setBusy(null); }
  };

  const label = scope === 'project' ? t('Project budget', '프로젝트 예산') : t('Global service budget', '전체 서비스 예산');
  return <Panel title={label} aside={<span className="mono text-[10.5px] text-muted-foreground" data-testid={`text-revision-${scope}`}>rev {s.revision}</span>} className="p-0">
    <div className="p-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="eyebrow">{t('Daily', '일일 한도')}</dt><dd className="mt-1.5 text-xl font-semibold" data-testid={`text-daily-${scope}`}>{fmtSec(s.dailySeconds)}</dd><dd className="mono text-[11px] text-muted-foreground">{s.dailySeconds}s{s.dailySeconds === 0 && ` · ${t('paused', '일시 중지')}`}</dd></div>
        <div><dt className="eyebrow">{t('Used', '사용')}</dt><dd className="mt-1.5 text-xl" data-testid={`text-used-${scope}`}>{fmtSec(s.usedSeconds)}</dd><dd className="mono text-[11px] text-muted-foreground">{s.usedSeconds}s</dd></div>
        <div><dt className="eyebrow">{t('Temporarily reserved', '임시 확보')}</dt><dd className="mt-1.5 text-xl" data-testid={`text-reserved-${scope}`}>{fmtSec(s.reservedSeconds ?? 0)}</dd><dd className="mono text-[11px] text-muted-foreground">{s.reservedSeconds ?? 0}s</dd></div>
        <div><dt className="eyebrow">{t('Remaining', '잔여')}</dt><dd className="mt-1.5 text-xl" data-testid={`text-remaining-${scope}`}>{fmtSec(s.remainingSeconds)}</dd><dd className="mono text-[11px] text-muted-foreground">{s.remainingSeconds}s</dd></div>
      </dl>
      <Meter s={s}/>
      <p className="mt-2 text-xs text-muted-foreground">{t('Usage is elapsed router session time, including setup, bounded by stop/end/expiry. Unspent reservations return after confirmed cleanup. Not speech-only time or provider billing.', '사용량은 준비 시간을 포함한 라우터 세션 경과 시간이며 종료 요청·종료·만료 시점으로 제한됩니다. 미사용 확보분은 정리 확인 후 반환됩니다. 발화 시간이나 제공자 청구액이 아닙니다.')}</p>
      {s.resetAt && <p className="mt-2 text-xs text-muted-foreground">{t('Last manual reset: ', '마지막 수동 초기화: ')}{fmtTime(s.resetAt)}</p>}

      {!editable ? <p className="mt-4 text-xs text-muted-foreground" data-testid={`text-readonly-${scope}`}>{t('Read-only. Only a trusted operator can change the service-wide budget.', '조회 전용입니다. 전체 서비스 예산은 승인된 운영자만 변경할 수 있습니다.')}</p> : <div className="mt-5 space-y-4 border-t border-card-border pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm"><span className="eyebrow block">{t('New daily limit (minutes, 0-1440)', '새 일일 한도 (분, 0-1440)')}</span>
            <input data-testid={`input-minutes-${scope}`} inputMode="numeric" value={minutes} disabled={disabled}
              onChange={e => { setMinutes(e.target.value); setDirty(true); setCostOk(false); }}
              className="mono mt-1.5 w-32 rounded border bg-background px-2.5 py-1.5"/></label>
          {seconds !== null && <span className="mono pb-2 text-xs text-muted-foreground">= {seconds}s</span>}
          {dirty && <span className="pb-2 text-xs text-[hsl(var(--warn))]">{t('Unsaved', '저장 안 됨')}</span>}
        </div>
        {invalid === 'invalid' && <p className="text-xs text-destructive">{t('Enter whole minutes between 0 and 1440.', '0~1440 사이의 정수 분을 입력하세요.')}</p>}
        {invalid === 'exceeds_service' && <p className="text-xs text-destructive">{t(`Cannot exceed the service budget (${fmtSec(budget.service.dailySeconds)}).`, `서비스 예산(${fmtSec(budget.service.dailySeconds)})을 넘을 수 없습니다.`)}</p>}
        {seconds === 0 && !invalid && <p className="text-xs text-[hsl(var(--warn))]">{t('0 pauses all new live admissions. Running sessions are not ended.', '0은 새 라이브 연결을 모두 중지합니다. 진행 중인 세션은 종료되지 않습니다.')}</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" data-testid={`checkbox-cost-${scope}`} checked={costOk} disabled={disabled || !!invalid} onChange={e => setCostOk(e.target.checked)} className="mt-1"/>
          <span>{t('I understand a higher limit allows more paid Tavus usage. This router budget is not Tavus billing or a credit balance.', '한도를 높이면 Tavus 유료 사용이 늘어날 수 있음을 이해합니다. 이 라우터 예산은 Tavus 청구나 크레딧 잔액이 아닙니다.')}</span></label>
        <div className="flex flex-wrap gap-3">
          <button data-testid={`button-save-${scope}`} className="arw-button primary" disabled={disabled || !costOk || !!invalid} onClick={save}><Save size={14}/>{busy === 'save' ? t('Saving...', '저장 중...') : t('Save limit', '한도 저장')}</button>
          <button data-testid={`button-open-reset-${scope}`} className="arw-button" disabled={disabled} onClick={() => { setResetOpen(!resetOpen); setResetOk(false); }}><RotateCcw size={14}/>{t('Reset used counter...', '사용 카운터 초기화...')}</button>
        </div>
        {resetOpen && <div className="console-note console-warning space-y-3" data-testid={`panel-reset-${scope}`}>
          <p className="text-sm">{t('This resets only the selected router accounting scope. It does not erase sessions or logs, refund Tavus, clear cleanup blocks, or reset hourly quotas. Other accounting scopes are unchanged.', '선택한 범위의 라우터 사용 카운터만 초기화합니다. 세션·로그 삭제, Tavus 환불, 정리 차단 해제, 시간당 한도 초기화는 하지 않습니다. 다른 범위의 사용량은 유지됩니다.')}</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" data-testid={`checkbox-reset-${scope}`} checked={resetOk} disabled={disabled} onChange={e => setResetOk(e.target.checked)} className="mt-1"/><span>{t('I understand this can allow additional paid usage; reset only the internal counter.', '추가 유료 사용이 허용될 수 있음을 이해하며 내부 카운터만 초기화합니다.')}</span></label>
          <button data-testid={`button-reset-${scope}`} className="arw-button" disabled={disabled || !resetOk} onClick={doReset}>{busy === 'reset' ? t('Resetting...', '초기화 중...') : t('Confirm reset', '초기화 확인')}</button>
        </div>}
        {error && <div role="alert" className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid={`text-error-${scope}`}><AlertTriangle size={16} className="mt-0.5 shrink-0"/><span>{error}</span></div>}
      </div>}
    </div>
  </Panel>;
}

export function WorkspaceBudgetPanel({ projectId, userId }: { projectId: string; userId: string }) {
  const { lang } = useI18n();
  const t = (en: string, ko: string) => lang === 'ko' ? ko : en;
  const q = useGetWorkspaceBudget(projectId, { query: {
    queryKey: [...getGetWorkspaceBudgetQueryKey(projectId), userId] as unknown as ReturnType<typeof getGetWorkspaceBudgetQueryKey>,
    enabled: !!projectId && !!userId, staleTime: 5000, refetchInterval: 15000, retry: false,
  } });
  const [notice, setNotice] = useState<string | null>(null);
  if (q.isLoading) return <div className="space-y-4"><Skel className="h-40"/><Skel className="h-32"/></div>;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} message={q.error ? errMsg(q.error) : undefined}/>;
  const b = q.data;
  return <div className="space-y-5">
    <div className="console-note"><strong>{t('Router admission budget, not Tavus billing.', '라우터 연결 허용 예산이며 Tavus 청구가 아닙니다.')}</strong> {t('These limits decide whether AvatarRouter admits new live sessions. They do not reflect Tavus credits, invoices or provider balance.', '이 한도는 AvatarRouter가 새 라이브 세션을 허용할지만 결정합니다. Tavus 크레딧·청구서·잔액을 나타내지 않습니다.')}</div>
    {notice && <div className="console-note" role="status" data-testid="text-budget-notice">{notice}</div>}
    <dl className="grid gap-4 sm:grid-cols-2">
      <Panel className="p-5"><dt className="eyebrow">{t('Max per session', '세션당 최대')}</dt><dd className="mt-2 text-xl" data-testid="text-session-cap">{fmtSec(b.sessionSeconds)} <span className="mono text-xs text-muted-foreground">{b.sessionSeconds}s</span></dd></Panel>
      <Panel className="p-5"><dt className="eyebrow">{t('Automatic daily reset', '자동 일일 초기화')}</dt><dd className="mt-2 text-sm" data-testid="text-resets-at">{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(b.resetsAt))} <span className="text-xs text-muted-foreground">(KST)</span></dd></Panel>
    </dl>
    <ScopeCard scope="project" s={b.project} editable budget={b} projectId={projectId} userId={userId} onDone={(_, m) => setNotice(m)}/>
    <ScopeCard scope="service" s={b.service} editable={b.canManageService} budget={b} projectId={projectId} userId={userId} onDone={(_, m) => setNotice(m)}/>
  </div>;
}
