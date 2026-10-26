import { useGetUsage } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { ErrorState, PageHead, Panel, Skel, fmtSec } from '@/components/bits';

export default function Usage() {
  const { t } = useI18n();
  const q = useGetUsage({ query: { refetchInterval: (x) => ((x.state.data?.activeSessions ?? 0) > 0 ? 3000 : false) } });
  return (
    <div>
      <PageHead index="05 / usage" title={t('use.title')} lede={t('use.lede')} />
      {q.isLoading ? <div className="grid grid-cols-2 gap-4 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skel key={i} className="h-28" />)}</div>
        : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} />
        : (
          <>
            <div className="rise grid grid-cols-2 overflow-hidden rounded-md border bg-card md:grid-cols-5">
              {[
                [t('use.total'), q.data.totalSessions],
                [t('use.active'), q.data.activeSessions],
                [t('use.connected'), fmtSec(q.data.durationSeconds)],
                [t('use.errors'), q.data.errors],
                [t('use.mock'), q.data.mockSessions],
              ].map(([k, v], i) => (
                <div key={String(k)} className="border-b border-r p-5" data-testid={`stat-${i}`}>
                  <div className="eyebrow">{k}</div>
                  <div className="mt-3 text-4xl font-bold tabular-nums tracking-tight">{v}</div>
                </div>
              ))}
            </div>
            <Panel title={t('use.billing')} className="mt-8">
              <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
                {[[t('use.est'), q.data.estimatedCost], [t('use.conf'), q.data.confirmedCost], [t('use.billable'), q.data.billableSeconds]].map(([k, v]) => (
                  <div key={String(k)} className="p-5">
                    <div className="eyebrow">{k}</div>
                    <div className="mono mt-3 text-lg">{v === null ? <span className="text-muted-foreground">null · {t('use.unsourced')}</span> : String(v)}</div>
                  </div>
                ))}
              </div>
              <p className="border-t px-5 py-3 text-sm text-muted-foreground">{t('use.why')}</p>
            </Panel>
          </>
        )}
    </div>
  );
}
