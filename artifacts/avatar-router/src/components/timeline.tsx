import { useListSessionEvents, getListSessionEventsQueryKey } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { ErrorState, Skel } from '@/components/bits';

export function Timeline({ sessionId, live }: { sessionId: string; live: boolean }) {
  const { t } = useI18n();
  const q = useListSessionEvents(sessionId, {
    query: { queryKey: getListSessionEventsQueryKey(sessionId), enabled: !!sessionId, refetchInterval: live ? 2000 : false },
  });
  if (q.isLoading) return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skel key={i} className="h-8" />)}</div>;
  if (q.isError) return <div className="p-4"><ErrorState onRetry={() => q.refetch()} /></div>;
  const events = q.data ?? [];
  if (!events.length) return <p className="p-4 text-sm text-muted-foreground">{t('sess.noEvents')}</p>;
  return (
    <ol className="relative p-4 pl-8" data-testid="list-events">
      <span className="absolute bottom-6 left-[19px] top-6 w-px bg-border" />
      {events.map((e, i) => (
        <li key={e.id} className="rise relative pb-4 last:pb-0" style={{ animationDelay: `${i * 40}ms` }} data-testid={`row-event-${e.id}`}>
          <span className="absolute -left-[17px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="mono text-[11px] font-semibold uppercase tracking-wider text-primary">{e.type}</span>
            <span className="mono text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
          </div>
          <p className="mt-0.5 text-sm">{e.message}</p>
        </li>
      ))}
    </ol>
  );
}
