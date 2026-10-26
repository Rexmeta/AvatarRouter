import { ExternalLink } from 'lucide-react';
import { useGetSetup, useListProviders } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { ErrorState, PageHead, Panel, Pill, Skel } from '@/components/bits';

export default function Providers() {
  const { t } = useI18n();
  const q = useListProviders();
  const setup = useGetSetup();
  return (
    <div>
      <PageHead index="03 / providers" title={t('prov.title')} lede={t('prov.lede')} />
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-56" />)}</div>
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {(q.data ?? []).map((p, i) => (
            <article key={p.id} className="rise flex flex-col rounded-md border border-card-border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ animationDelay: `${i * 60}ms` }} data-testid={`card-provider-${p.id}`}>
              <div className="flex items-start justify-between gap-3 border-b p-4">
                <div>
                  <h2 className="text-lg font-bold">{p.name}</h2>
                  <p className="text-sm text-muted-foreground">{p.description}</p>
                </div>
                <Pill value={p.status} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
                <div><dt className="eyebrow">{t('prov.runtime')}</dt><dd className="mono">{p.runtime}</dd></div>
                <div><dt className="eyebrow">{t('prov.modes')}</dt><dd className="mono">{p.modes.join(', ') || '—'}</dd></div>
                <div><dt className="eyebrow">{t('prov.extAudio')}</dt><dd>{p.externalAudio ? t('yes') : t('no')}</dd></div>
                <div><dt className="eyebrow">{t('prov.impl')}</dt><dd><Pill value={p.implemented ? 'implemented' : 'pending'} label={p.implemented ? t('prov.implemented') : t('prov.pending')} /></dd></div>
                <div className="col-span-2"><dt className="eyebrow">{t('prov.validation')}</dt><dd>{p.validation}</dd></div>
                {p.missing.length > 0 && (
                  <div className="col-span-2"><dt className="eyebrow">{t('pg.missing')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">{p.missing.map((m) => <span key={m} className="mono rounded-sm bg-muted px-1.5 py-0.5 text-[11.5px]">{m}</span>)}</dd>
                  </div>
                )}
              </dl>
              <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="mt-auto flex items-center justify-between border-t px-4 py-2.5 text-sm text-primary hover:bg-muted/40" data-testid={`link-source-${p.id}`}>
                {t('prov.source')} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </article>
          ))}
        </div>
      )}

      <Panel title={t('secrets')} className="mt-8">
        {setup.isLoading ? <div className="p-4"><Skel className="h-20" /></div>
          : setup.isError ? <div className="p-4"><ErrorState onRetry={() => setup.refetch()} /></div>
          : (
            <>
              <ul className="grid divide-y md:grid-cols-2 md:divide-y-0">
                {(setup.data?.checks ?? []).map((c) => (
                  <li key={c.key} className="flex items-start justify-between gap-3 border-b px-4 py-3" data-testid={`row-setup-${c.key}`}>
                    <div><div className="mono text-[12.5px] font-medium">{c.key}</div><p className="text-xs text-muted-foreground">{c.description}</p></div>
                    <Pill value={c.configured ? 'available' : 'unconfigured'} label={c.configured ? t('present') : t('absent')} />
                  </li>
                ))}
              </ul>
              <p className="px-4 py-3 text-xs text-muted-foreground">{t('secrets.note')}</p>
            </>
          )}
      </Panel>
    </div>
  );
}
