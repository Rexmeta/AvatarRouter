import { Link } from 'wouter';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useGetSetup, useListAvatars, useListProviders } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { ErrorState, Orb, Panel, Pill, Skel } from '@/components/bits';

export default function Home() {
  const { t } = useI18n();
  const providers = useListProviders();
  const avatars = useListAvatars();
  const setup = useGetSetup();

  return (
    <div>
      <section className="rise grid items-center gap-10 pb-12 md:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="eyebrow mb-4">AvatarRouter Studio / {t('phase')}</div>
          <h1 className="text-4xl font-extrabold leading-[1.02] tracking-tight md:text-6xl">
            {t('home.title1')}
            <span className="block text-primary">{t('home.title2')}</span>
          </h1>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted-foreground">{t('home.lede')}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/playground" data-testid="link-cta-playground" className="group inline-flex items-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition active:scale-[.98]">
              {t('home.openPlayground')} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </Link>
            <Link href="/docs" data-testid="link-cta-docs" className="inline-flex items-center gap-2 rounded border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-muted">
              {t('home.readFindings')}
            </Link>
          </div>
        </div>
        <div className="flex flex-col items-center">
          <Orb active interruptPulse={0} />
          <p className="mono mt-2 text-center text-[11px] text-muted-foreground">mock-orbit / {t('home.mockNote')}</p>
        </div>
      </section>

      <Panel title={t('home.integration')} className="mb-8">
        {setup.isLoading ? (
          <div className="grid gap-4 p-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skel key={i} className="h-12" />)}</div>
        ) : setup.isError ? (
          <div className="p-4"><ErrorState onRetry={() => setup.refetch()} /></div>
        ) : setup.data ? (
          <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
            {[
              [t('stage'), setup.data.stage],
              [t('roleplayx'), setup.data.roleplayxStatus],
              [t('bridge'), setup.data.bridgeStatus],
            ].map(([k, v]) => (
              <div key={k} className="p-4">
                <div className="eyebrow mb-2">{k}</div>
                <Pill value={v} />
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <Panel title={t('home.providers')} aside={<Link href="/providers" className="mono text-[11px] text-primary hover:underline" data-testid="link-all-providers">/providers</Link>}>
          {providers.isLoading ? (
            <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skel key={i} className="h-14" />)}</div>
          ) : providers.isError ? (
            <div className="p-4"><ErrorState onRetry={() => providers.refetch()} /></div>
          ) : (
            <ul className="divide-y">
              {(providers.data ?? []).map((p) => (
                <li key={p.id} className="group flex items-start justify-between gap-4 px-4 py-3 transition hover:bg-muted/40" data-testid={`row-provider-${p.id}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold">{p.name}<span className="mono text-[11px] font-normal text-muted-foreground">{p.runtime}</span></div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                  </div>
                  <Pill value={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('home.avatars')}>
          {avatars.isLoading ? (
            <div className="space-y-3 p-4">{[0, 1].map((i) => <Skel key={i} className="h-14" />)}</div>
          ) : avatars.isError ? (
            <div className="p-4"><ErrorState onRetry={() => avatars.refetch()} /></div>
          ) : (
            <ul className="divide-y">
              {(avatars.data ?? []).map((a) => (
                <li key={a.id} className="px-4 py-3" data-testid={`row-avatar-${a.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{a.name}</span>
                    <Pill value={a.kind === 'mock' ? 'ended' : a.configured ? 'available' : 'unconfigured'} label={a.kind} />
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{a.description}</p>
                  <div className="mono mt-1 text-[11px] text-muted-foreground">{a.providerId} · {a.id}{a.languages.length ? ` · ${a.languages.join(', ')}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/playground" className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-primary hover:bg-muted/40" data-testid="link-avatar-playground">
            {t('home.openPlayground')} <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Panel>
      </div>
    </div>
  );
}
