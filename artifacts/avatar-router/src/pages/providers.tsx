import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  getGetOperatorVoiceCatalogQueryKey, useGetOperatorVoiceCatalog, useGetSetup,
  useListProviders, useSetOperatorVoiceGender,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { ErrorState, PageHead, Panel, Pill, Skel } from '@/components/bits';

export default function Providers() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const q = useListProviders({ query: { staleTime: 0, refetchOnMount: 'always' } });
  const setup = useGetSetup();
  const voiceCatalog = useGetOperatorVoiceCatalog({ query: { staleTime: 0, refetchOnMount: 'always' } });
  const setVoiceGender = useSetOperatorVoiceGender({ mutation: {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOperatorVoiceCatalogQueryKey() }),
  } });
  const [voiceFilter, setVoiceFilter] = useState('');
  const filteredVoices = (voiceCatalog.data?.voices ?? []).filter(voice => {
    const query = voiceFilter.trim().toLowerCase();
    return !query || `${voice.providerId} ${voice.name} ${voice.id}`.toLowerCase().includes(query);
  });
  return (
    <div>
      <PageHead index="03 / providers" title={t('prov.title')} lede={t('prov.lede')} />
      <p className="mb-6 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground" data-testid="provider-status-note">{t('prov.statusNote')}</p>
      <div className="mb-6 rounded-md border p-4 text-sm" data-testid="tavus-paid-plan-note">
        <h2 className="font-semibold">Tavus · RoleplayX</h2>
        <p className="mt-2 text-muted-foreground">{lang === 'ko'
          ? 'Full pipeline은 Tavus의 대화·음성·영상을 함께 사용하며 LiveKit 설정이 필요하지 않습니다. Gemini 음성을 동시에 실행하지 마세요. 유료 업그레이드가 라우터 예산·정리 제한을 해제하거나 실제 잔액·연결 성공을 보장하지는 않습니다.'
          : 'Full pipeline uses Tavus dialogue, voice and video together without LiveKit. Do not run Gemini voice simultaneously. A paid upgrade does not remove router budgets or cleanup limits, or verify balance and playback.'}</p>
        <a className="mt-2 inline-block text-primary underline" href={`${import.meta.env.BASE_URL}roleplayx/tavus-paid-plan.md`} target="_blank" rel="noreferrer">
          {lang === 'ko' ? '유료 계정·RoleplayX 연동 안내' : 'Paid account and RoleplayX integration guide'}
        </a>
      </div>
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

      <Panel title={lang === 'ko' ? '음성 카탈로그 · 운영자 분류' : 'Voice catalog · operator curation'} className="mt-8">
        <div className="border-b p-4">
          <p className="text-sm text-muted-foreground">
            {lang === 'ko'
              ? '제공자가 성별을 제공하지 않는 음성은 운영자가 직접 분류해야 외부 앱의 성별 필터에 표시됩니다. 미리듣기 URL과 공급자 응답 원문은 노출하지 않습니다.'
              : 'Voices without provider gender metadata must be classified by an operator before gender filters can select them. Preview URLs and raw provider responses are never shown.'}
          </p>
          {voiceCatalog.data && (
            <div className="mt-3 flex flex-wrap gap-2">
              {voiceCatalog.data.providers.map(provider => (
                <span key={provider.providerId} className="rounded-sm border px-2 py-1 text-xs">
                  {provider.providerId} · {provider.status}
                </span>
              ))}
            </div>
          )}
          {voiceCatalog.isError && (
            <p role="alert" className="mt-3 text-sm text-amber-800">
              {lang === 'ko'
                ? '음성 분류 화면은 신뢰된 운영자 계정만 사용할 수 있습니다. 운영 권한이나 공급자 카탈로그 상태를 확인하세요.'
                : 'This voice curation panel requires a trusted operator account. Check operator access and provider catalog status.'}
            </p>
          )}
          {voiceCatalog.isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
          {voiceCatalog.data && (
            <label className="mt-3 block max-w-md text-sm">
              {lang === 'ko' ? '음성 검색' : 'Search voices'}
              <input
                value={voiceFilter}
                onChange={event => setVoiceFilter(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                placeholder={lang === 'ko' ? '제공자, 이름 또는 음성 ID' : 'Provider, name or voice ID'}
              />
            </label>
          )}
        </div>
        {voiceCatalog.data && (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 bg-muted/70 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Provider / Voice</th>
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2">Gender</th>
                  <th className="px-4 py-2">Availability</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredVoices.map(voice => (
                  <tr key={`${voice.providerId}:${voice.id}`} data-testid={`voice-row-${voice.providerId}-${voice.id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{voice.name} <span className="text-xs text-muted-foreground">· {voice.providerId}</span></div>
                      <div className="mono mt-1 break-all text-xs text-muted-foreground">{voice.id}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{voice.genderSource}</td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Gender for ${voice.providerId} ${voice.name}`}
                        value={voice.gender}
                        disabled={!voice.available || setVoiceGender.isPending}
                        onChange={event => setVoiceGender.mutate({
                          providerId: voice.providerId,
                          voiceId: voice.id,
                          data: { gender: event.target.value as 'male' | 'female' | 'neutral' | 'unclassified' },
                        })}
                        className="h-9 rounded-md border bg-background px-2"
                      >
                        <option value="unclassified">Unclassified</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="neutral">Neutral</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs">{voice.available ? 'Available' : 'Unavailable'}</td>
                  </tr>
                ))}
                {!filteredVoices.length && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {lang === 'ko' ? '검색 결과가 없습니다.' : 'No voices match this search.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {setVoiceGender.isError && (
          <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">
            {lang === 'ko' ? '성별 분류를 저장하지 못했습니다. 권한과 카탈로그 상태를 확인하세요.' : 'Could not save the gender classification. Check operator access and catalog availability.'}
          </p>
        )}
      </Panel>
    </div>
  );
}
