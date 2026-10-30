import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, BookOpen, Boxes, Compass, FlaskConical, ImageUp, KeyRound, ListTree, ShieldCheck } from 'lucide-react';
import { AuthControl } from '@/components/auth-control';
import { useGetHealth, useGetReadiness, useHealthCheck } from '@workspace/api-client-react';
import { useI18n, type TKey } from '@/lib/i18n';
import { Pill } from '@/components/bits';
import { cn } from '@/lib/utils';

const nav: { href: string; key: TKey; icon: typeof Compass }[] = [
  { href: '/', key: 'nav.explore', icon: Compass },
  { href: '/playground', key: 'nav.playground', icon: FlaskConical },
  { href: '/avatar-assets', key: 'nav.assets', icon: ImageUp },
  { href: '/providers', key: 'nav.providers', icon: Boxes },
  { href: '/sessions', key: 'nav.sessions', icon: ListTree },
  { href: '/operator/live-reconciliation', key: 'nav.reconciliation', icon: ShieldCheck },
  { href: '/usage', key: 'nav.usage', icon: Activity },
  { href: '/api-keys', key: 'nav.apiKeys', icon: KeyRound },
  { href: '/docs', key: 'nav.docs', icon: BookOpen },
];

function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="mono flex rounded border border-sidebar-border p-0.5 text-[11px]" role="group">
      {(['en', 'ko'] as const).map((l) => (
        <button
          key={l}
          data-testid={`button-lang-${l}`}
          onClick={() => setLang(l)}
          className={cn('rounded-sm px-2 py-0.5 uppercase transition', lang === l ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'opacity-60 hover:opacity-100')}
        >
          {l === 'en' ? 'EN' : '한'}
        </button>
      ))}
    </div>
  );
}

function Diagnostics() {
  const { t } = useI18n();
  const hz = useHealthCheck({ query: { refetchInterval: 30000 } });
  const h = useGetHealth({ query: { refetchInterval: 30000 } });
  const r = useGetReadiness({ query: { refetchInterval: 30000 } });
  return (
    <div className="space-y-1.5 text-[11px]" data-testid="footer-diagnostics">
      <Row label="healthz" v={hz.isError ? 'error' : hz.data?.status ?? '…'} />
      <Row label={t('footer.api')} v={h.isError ? 'error' : h.data?.status ?? '…'} />
      <Row label={t('footer.db')} v={r.data ? (r.data.database ? 'ok' : 'error') : r.isError ? 'error' : '…'} />
      <Row label={t('footer.live')} v={r.data ? (r.data.liveEnabled ? 'available' : 'pending') : '…'} text={r.data ? (r.data.liveEnabled ? t('enabled') : t('disabled')) : undefined} />
      {r.data?.message && <p className="pt-1 leading-snug opacity-50">{r.data.message}</p>}
    </div>
  );
}

function Row({ label, v, text }: { label: string; v: string; text?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="mono opacity-60">{label}</span>
      {v === '…' ? <span className="opacity-40">…</span> : <Pill value={v} label={text} />}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { t } = useI18n();
  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      <aside className="sticky top-0 z-40 flex shrink-0 flex-col bg-sidebar text-sidebar-foreground md:h-[100dvh] md:w-60">
        <div className="flex items-center justify-between gap-3 px-5 py-4 md:block">
          <Link href="/" className="flex items-center gap-2.5" data-testid="link-home">
            <svg viewBox="0 0 24 24" className="h-6 w-6">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity=".35" />
              <circle cx="12" cy="12" r="5" fill="hsl(var(--sidebar-primary))" />
              <path d="M2 12h5M17 12h5" stroke="currentColor" />
            </svg>
            <div className="leading-tight">
              <div className="text-[15px] font-bold tracking-tight">AvatarRouter</div>
              <div className="mono text-[10px] uppercase tracking-widest opacity-50">Studio</div>
            </div>
          </Link>
          <div className="flex items-center gap-2 md:mt-4"><LangToggle /><AuthControl /></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {nav.map(({ href, key, icon: Icon }) => {
            const on = href === '/' ? loc === '/' : loc.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                data-testid={`link-${href.slice(1) || 'explore'}`}
                className={cn(
                  'group relative flex shrink-0 items-center gap-2.5 rounded px-3 py-2 text-sm transition',
                  on ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'opacity-65 hover:bg-sidebar-accent/60 hover:opacity-100',
                )}
              >
                <span className={cn('absolute left-0 top-1/2 hidden h-4 w-[3px] -translate-y-1/2 rounded-r bg-sidebar-primary transition md:block', on ? 'opacity-100' : 'opacity-0')} />
                <Icon className="h-4 w-4 transition group-hover:translate-x-0.5" />
                {t(key)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-sidebar-border px-5 py-4 md:block">
          <div className="mono mb-3 text-[10px] uppercase tracking-widest text-sidebar-primary">{t('phase')}</div>
          <Diagnostics />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">{children}</div>
        <div className="border-t px-5 py-4 md:hidden bg-sidebar text-sidebar-foreground"><Diagnostics /></div>
      </main>
    </div>
  );
}
