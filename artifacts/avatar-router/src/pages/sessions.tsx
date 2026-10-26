import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Square, Zap } from 'lucide-react';
import {
  useListSessions, useGetSession, useEndSession, useInterruptSession,
  getListSessionsQueryKey, getGetSessionQueryKey, getListSessionEventsQueryKey, getGetUsageQueryKey,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { ErrorState, PageHead, Panel, Pill, Skel, errMsg, fmtSec, fmtTime } from '@/components/bits';
import { Timeline } from '@/components/timeline';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function Detail({ id }: { id: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetSession(id, { query: { queryKey: getGetSessionQueryKey(id), refetchInterval: (x) => (x.state.data?.status === 'active' ? 2000 : false) } });
  const end = useEndSession();
  const intr = useInterruptSession();
  const inv = () => {
    qc.invalidateQueries({ queryKey: getGetSessionQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionEventsQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUsageQueryKey() });
  };
  const onErr = (e: unknown) => toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' });
  if (q.isLoading) return <div className="p-4"><Skel className="h-40" /></div>;
  if (q.isError || !q.data) return <div className="p-4"><ErrorState onRetry={() => q.refetch()} /></div>;
  const s = q.data;
  const active = s.status === 'active';
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <div className="mono text-[12px] text-muted-foreground" data-testid="text-session-id">{s.id}</div>
          <div className="mt-1 flex items-center gap-2 font-semibold">{s.providerId} / {s.avatarId} <Pill value={s.status} live={active} /></div>
        </div>
        {active && (
          <div className="flex gap-2">
            <button data-testid="button-session-interrupt" disabled={intr.isPending} onClick={() => intr.mutate({ id }, { onSuccess: inv, onError: onErr })} className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"><Zap className="h-3.5 w-3.5" />{t('pg.interrupt')}</button>
            <button data-testid="button-session-end" disabled={end.isPending} onClick={() => end.mutate({ id }, { onSuccess: inv, onError: onErr })} className="inline-flex items-center gap-1.5 rounded border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/5 disabled:opacity-40"><Square className="h-3.5 w-3.5" />{t('pg.end')}</button>
          </div>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 border-b p-4 text-sm md:grid-cols-3">
        <div><dt className="eyebrow">mode</dt><dd className="mono">{s.mode}</dd></div>
        <div><dt className="eyebrow">{t('started')}</dt><dd>{fmtTime(s.startedAt)}</dd></div>
        <div><dt className="eyebrow">{t('ended')}</dt><dd>{fmtTime(s.endedAt)}</dd></div>
        <div><dt className="eyebrow">{t('expires')}</dt><dd>{fmtTime(s.expiresAt)}</dd></div>
        <div><dt className="eyebrow">{t('duration')}</dt><dd className="mono">{fmtSec(s.durationSeconds)}</dd></div>
        <div><dt className="eyebrow">{t('interruptions')}</dt><dd className="mono">{s.interruptions}</dd></div>
        {s.error && <div className="col-span-full"><dt className="eyebrow">{t('error')}</dt><dd className="text-destructive">{s.error}</dd></div>}
      </dl>
      <div className="eyebrow px-4 pt-4">{t('sess.events')}</div>
      <Timeline sessionId={id} live={active} />
    </div>
  );
}

export default function Sessions() {
  const { t } = useI18n();
  const q = useListSessions({ query: { refetchInterval: (x) => (x.state.data?.some((s) => s.status === 'active') ? 3000 : false) } });
  const [sel, setSel] = useState('');
  return (
    <div>
      <PageHead index="04 / sessions" title={t('sess.title')} lede={t('sess.lede')} />
      {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skel key={i} className="h-14" />)}</div>
        : q.isError ? <ErrorState onRetry={() => q.refetch()} />
        : !q.data?.length ? (
          <div className="rise flex flex-col items-center rounded-md border border-dashed bg-card/60 px-6 py-16 text-center">
            <svg viewBox="0 0 60 60" className="mb-4 h-14 w-14 text-muted-foreground"><circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeDasharray="3 5" /><circle cx="30" cy="30" r="6" fill="hsl(var(--primary))" /></svg>
            <p className="max-w-sm text-sm text-muted-foreground">{t('sess.empty')}</p>
            <Link href="/playground" className="mt-4 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="link-empty-playground">{t('home.openPlayground')}</Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <Panel title={`${q.data.length} total`}>
              <ul className="max-h-[70vh] divide-y overflow-y-auto">
                {q.data.map((s) => (
                  <li key={s.id}>
                    <button data-testid={`row-session-${s.id}`} onClick={() => setSel(s.id)}
                      className={cn('flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/50', sel === s.id && 'bg-accent/50')}>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{s.providerId} <span className="mono text-[11px] font-normal text-muted-foreground">{s.mode}</span></div>
                        <div className="mono truncate text-[11px] text-muted-foreground">{fmtTime(s.startedAt)} · {fmtSec(s.durationSeconds)}</div>
                      </div>
                      <Pill value={s.status} live={s.status === 'active'} />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="inspect">{sel ? <Detail key={sel} id={sel} /> : <p className="p-4 text-sm text-muted-foreground">{t('sess.select')}</p>}</Panel>
          </div>
        )}
    </div>
  );
}
