import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Play, Square, Zap } from 'lucide-react';
import {
  useCreateSession, useEndSession, useInterruptSession, useGetSession, useListProviders, useListAvatars, useGetSetup,
  getGetSessionQueryKey, getListSessionsQueryKey, getListSessionEventsQueryKey, getGetUsageQueryKey,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { ErrorState, MicCheck, Orb, PageHead, Panel, Pill, Skel, errMsg, fmtSec } from '@/components/bits';
import { SelectedAssetPanel, useValidatedSelectedAsset } from '@/components/selected-asset';
import type { AvatarAsset } from '@workspace/api-client-react';
import { StockLivePanel } from '@/components/stock-live';
import { Timeline } from '@/components/timeline';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Target = 'mock' | 'anam' | 'tavus';
const KEY = 'ar-active-session';

export default function Playground() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [target, setTarget] = useState<Target>('mock');
  const [sid, setSid] = useState<string>(() => sessionStorage.getItem(KEY) ?? '');
  const [pulse, setPulse] = useState(0);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (sid) sessionStorage.setItem(KEY, sid);
    else sessionStorage.removeItem(KEY);
  }, [sid]);

  const providers = useListProviders();
  const avatars = useListAvatars();
  const setup = useGetSetup();
  const session = useGetSession(sid, {
    query: {
      queryKey: getGetSessionQueryKey(sid),
      enabled: !!sid,
      refetchInterval: (q) => (q.state.data?.status === 'active' ? 2000 : false),
    },
  });
  const s = session.data;
  const active = s?.status === 'active';

  const invalidate = (id: string) => {
    qc.invalidateQueries({ queryKey: getGetSessionQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionEventsQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUsageQueryKey() });
  };

  const create = useCreateSession();
  const end = useEndSession();
  const interrupt = useInterruptSession();

  const startMock = () =>
    create.mutate(
      { data: { providerId: 'mock', avatarId: 'mock-orbit', mode: 'mock' } },
      {
        onSuccess: (ns) => { setSid(ns.id); invalidate(ns.id); },
        onError: (e) => toast({ title: 'Session not created', description: errMsg(e), variant: 'destructive' }),
      },
    );

  const asset = useValidatedSelectedAsset();
  const [assetLiveError, setAssetLiveError] = useState<string | null>(null);

  const liveWithAsset = (r: AvatarAsset) => {
    setAssetLiveError(null);
    if (r.status !== 'ready' || !r.providerAvatarId || r.providerId !== 'tavus') {
      setAssetLiveError('Select a ready Tavus asset. Anam live runtime remains unavailable.');
      return;
    }
    document.getElementById('stock')?.scrollIntoView({ behavior: 'smooth' });
  };

  const requestLive = (pid: 'anam' | 'tavus') => {
    setLiveError(null);
    const r = asset.record;
    if (asset.sel && asset.sel.providerId === pid) {
      if (asset.ready && r && r.providerId === pid) { liveWithAsset(r); return; }
      setLiveError('Selected avatar asset is not ready (or could not be validated). Clear the selection to use the catalog avatar.');
      return;
    }
    if (pid === 'tavus') {
      document.getElementById('stock')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const av = avatars.data?.find((a) => a.providerId === pid);
    create.mutate(
      { data: { providerId: pid, avatarId: av?.id ?? `${pid}-unconfigured`, mode: 'live' } },
      {
        onSuccess: (ns) => { setSid(ns.id); invalidate(ns.id); },
        onError: (e) => { setLiveError(errMsg(e)); qc.invalidateQueries({ queryKey: getGetUsageQueryKey() }); },
      },
    );
  };

  const doInterrupt = () =>
    interrupt.mutate({ id: sid }, {
      onSuccess: () => { setPulse((p) => p + 1); invalidate(sid); },
      onError: (e) => toast({ title: 'Interrupt failed', description: errMsg(e), variant: 'destructive' }),
    });
  const doEnd = () =>
    end.mutate({ id: sid }, {
      onSuccess: () => invalidate(sid),
      onError: (e) => toast({ title: 'End failed', description: errMsg(e), variant: 'destructive' }),
    });

  const prov = providers.data?.find((p) => p.id === target);
  const relevantChecks = (setup.data?.checks ?? []).filter((c) => target === 'mock' || c.key.toLowerCase().includes(target) || c.key.toLowerCase().includes('livekit'));

  return (
    <div>
      <PageHead index="02 / playground" title={t('pg.title')} lede={t('pg.lede')} />
      <StockLivePanel asset={asset.record ?? undefined} />
      <SelectedAssetPanel onRequestLive={liveWithAsset} pending={create.isPending} liveError={assetLiveError} />

      <div className="rise mb-6 flex flex-wrap gap-2" role="tablist">
        {(['mock', 'anam', 'tavus'] as Target[]).map((id) => {
          const p = providers.data?.find((x) => x.id === id);
          return (
            <button
              key={id}
              data-testid={`button-target-${id}`}
              onClick={() => { setTarget(id); setLiveError(null); }}
              className={cn(
                'flex items-center gap-3 rounded-md border px-4 py-2.5 text-left transition active:scale-[.98]',
                target === id ? 'border-primary bg-card shadow-md' : 'bg-card/60 hover:bg-card',
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', target === id ? 'bg-primary' : 'bg-muted-foreground/40')} />
              <span>
                <span className="block text-sm font-semibold">{id === 'mock' ? 'Local mock' : p?.name ?? id}</span>
                <span className="mono block text-[10.5px] text-muted-foreground">{id === 'mock' ? 'synthetic lifecycle' : p?.status ?? 'loading'}</span>
              </span>
            </button>
          );
        })}
      </div>

      {target === 'mock' ? (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Panel title="mock-orbit" aside={<span className="mono text-[10.5px] font-semibold text-[hsl(var(--warn))]">{t('pg.synthetic')}</span>}>
            <div className="relative flex flex-col items-center bg-[radial-gradient(circle_at_50%_40%,hsl(var(--accent)/.6),transparent_70%)] px-6 py-8">
              <Orb active={active} interruptPulse={pulse} />
              <div className="mt-4 flex items-center gap-3">
                {s ? <Pill value={s.status} live={active} /> : <Pill value="ended" label={t('pg.idle')} />}
                {s && <span className="mono text-xs text-muted-foreground" data-testid="text-duration">{fmtSec(s.durationSeconds)} · {s.interruptions} int.</span>}
              </div>
              {s?.error && <p className="mt-2 text-sm text-destructive">{s.error}</p>}
            </div>
            <div className="flex flex-wrap gap-2 border-t p-4">
              <button data-testid="button-start" disabled={active || create.isPending} onClick={startMock}
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97] disabled:opacity-40">
                <Play className="h-4 w-4" /> {create.isPending ? '…' : t('pg.start')}
              </button>
              <button data-testid="button-interrupt" disabled={!active || interrupt.isPending} onClick={doInterrupt}
                className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm transition hover:bg-muted active:scale-[.97] disabled:opacity-40">
                <Zap className="h-4 w-4" /> {t('pg.interrupt')}
              </button>
              <button data-testid="button-end" disabled={!active || end.isPending} onClick={doEnd}
                className="inline-flex items-center gap-2 rounded border border-destructive/40 px-4 py-2 text-sm text-destructive transition hover:bg-destructive/5 active:scale-[.97] disabled:opacity-40">
                <Square className="h-4 w-4" /> {t('pg.end')}
              </button>
            </div>
            <div className="border-t p-4">
              <div className="eyebrow mb-3">{t('mic.title')}</div>
              <MicCheck resetKey={`${sid}:${s?.status ?? 'idle'}`} />
            </div>
          </Panel>
          <Panel title={t('pg.timeline')} aside={s && <span className="mono text-[10.5px] text-muted-foreground">{s.id.slice(0, 8)}</span>}>
            {!sid ? <p className="p-4 text-sm text-muted-foreground">{t('pg.noSession')}</p>
              : session.isError ? <div className="p-4"><ErrorState onRetry={() => { setSid(''); }} message={errMsg(session.error)} /></div>
              : <Timeline sessionId={sid} live={active} />}
          </Panel>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Panel title={t('pg.diag')}>
            {providers.isLoading ? <div className="p-4"><Skel className="h-24" /></div>
              : providers.isError ? <div className="p-4"><ErrorState onRetry={() => providers.refetch()} /></div>
              : prov ? (
                <div className="space-y-5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="text-xl font-bold">{prov.name}</div><p className="text-sm text-muted-foreground">{prov.description}</p></div>
                    <Pill value={prov.status} />
                  </div>
                  <div>
                    <div className="eyebrow mb-2">{t('prov.validation')}</div>
                    <p className="text-sm">{prov.validation}</p>
                  </div>
                  <div>
                    <div className="eyebrow mb-2">{t('pg.missing')}</div>
                    {prov.missing.length ? (
                      <ul className="space-y-1.5">{prov.missing.map((m) => (
                        <li key={m} className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warn))]" /><span className="mono text-[12.5px]">{m}</span></li>
                      ))}</ul>
                    ) : <p className="text-sm text-muted-foreground">{t('pg.nothingMissing')}</p>}
                  </div>
                  <div className="border-t pt-4">
                    {target === 'tavus' && <p className="mb-3 text-sm text-muted-foreground" data-testid="note-tavus-stock"><a href="#stock" className="font-semibold text-primary underline-offset-2 hover:underline">Stock Lucy - Home</a> live test is at the top of this page.</p>}
                    <button data-testid="button-request-live" disabled={create.isPending} onClick={() => requestLive(target as 'anam' | 'tavus')}
                      className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm font-medium transition hover:bg-muted active:scale-[.97] disabled:opacity-40">
                      <Play className="h-4 w-4" /> {create.isPending ? '…' : t('pg.tryLive')}
                    </button>
                    {liveError && (
                      <div className="rise mt-3 rounded border border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/5 p-3" data-testid="text-live-error">
                        <div className="mono text-[11px] uppercase tracking-wider text-[hsl(var(--warn))]">server response</div>
                        <p className="mt-1 text-sm">{liveError}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : <p className="p-4 text-sm text-muted-foreground">Provider not listed by API.</p>}
          </Panel>
          <Panel title={t('secrets')}>
            {setup.isLoading ? <div className="p-4"><Skel className="h-24" /></div>
              : setup.isError ? <div className="p-4"><ErrorState onRetry={() => setup.refetch()} /></div>
              : (
                <ul className="divide-y">
                  {relevantChecks.map((c) => (
                    <li key={c.key} className="flex items-start justify-between gap-3 px-4 py-3" data-testid={`row-check-${c.key}`}>
                      <div><div className="mono text-[12.5px] font-medium">{c.key}</div><p className="text-xs text-muted-foreground">{c.description}</p></div>
                      <Pill value={c.configured ? 'available' : 'unconfigured'} label={c.configured ? t('present') : t('absent')} />
                    </li>
                  ))}
                  <li className="px-4 py-3 text-xs text-muted-foreground">{t('secrets.note')}</li>
                </ul>
              )}
          </Panel>
        </div>
      )}
    </div>
  );
}
