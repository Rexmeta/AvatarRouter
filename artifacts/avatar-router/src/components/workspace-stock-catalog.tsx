import { useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { ImageOff, Library, UserRound, AudioLines } from 'lucide-react';
import {
  useGetWorkspaceStockFaces, useGetWorkspaceStockVoices,
  getGetWorkspaceStockFacesQueryKey, getGetWorkspaceStockVoicesQueryKey,
  type WorkspaceStockProvider, type WorkspaceStockFace, type WorkspaceStockVoice, type WorkspaceStockSelection,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import {
  DEFAULT_STOCK_VOICE_FILTERS, STOCK_VOICE_GENDERS, filterStockVoices, stockVoiceLanguages,
  type StockVoiceFilters,
} from '@/lib/workspace-stock-voice-filters';
import { ErrorState, Panel, Pill, Skel } from '@/components/bits';

const PROVIDERS: { id: WorkspaceStockProvider; name: string }[] = [
  { id: 'tavus', name: 'Tavus' },
  { id: 'anam', name: 'Anam' },
];
const VOICE_PAGE_SIZE = 30;

function useL() {
  const { lang } = useI18n();
  return (en: string, ko: string) => (lang === 'en' ? en : ko);
}

export function WorkspaceStockCatalog({ projectId, kind }: { projectId: string; kind: 'faces' | 'voices' }) {
  const L = useL();
  const { user } = useUser();
  const uid = user?.id ?? 'anon';
  return (
    <section aria-labelledby="stock-catalog-title" data-testid="section-stock-catalog">
      <div className="mb-4 flex flex-col gap-1">
        <h2 id="stock-catalog-title" className="eyebrow flex items-center gap-1.5"><Library className="h-3 w-3" /> {L('Read-only catalog', '읽기 전용 카탈로그')}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {L(
            '"Selectable" means the existing RoleplayX integration supports choosing the item. It does not guarantee live admission, available quota, playback or compatibility with every face and voice pairing.',
            '‘선택 가능’은 기존 RoleplayX 연동에서 선택할 수 있다는 뜻입니다. 라이브 연결, 사용 한도, 재생 또는 모든 얼굴·음성 조합의 호환을 보장하지는 않습니다.',
          )}
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const Panel = kind === 'faces' ? FacesPanel : VoicesPanel;
          return <Panel key={`${uid}:${projectId}:${provider.id}:${kind}`} projectId={projectId} provider={provider} uid={uid} />;
        })}
      </div>
    </section>
  );
}

function SelectionPill({ s }: { s: WorkspaceStockSelection }) {
  const L = useL();
  return s === 'supported'
    ? <Pill value="available" label={L('Selectable', '선택 가능')} />
    : <Pill value="ended" label={L('Catalog only', '카탈로그 전용')} />;
}

function StatusBody({ status, kind, retry, refreshing }: {
  status: 'unconfigured' | 'unavailable'; kind: 'faces' | 'voices'; retry: () => void; refreshing: boolean;
}) {
  const L = useL();
  const what = kind === 'faces' ? L('faces', '얼굴') : L('voices', '음성');
  return (
    <div className="p-4" role="status" data-testid={`state-${kind}-${status}`}>
      <div className="rounded-md border border-dashed p-4 text-sm">
        <Pill value={status} label={status === 'unconfigured' ? L('Not configured', '미설정') : L('Unavailable', '이용 불가')} />
        <p className="mt-2 text-muted-foreground">
          {status === 'unconfigured'
            ? L(`This provider is not configured on the server, so stock ${what} cannot be listed.`, `서버에 이 프로바이더가 설정되지 않아 기본 ${what} 목록을 불러올 수 없습니다.`)
            : L(`The stock ${what} list couldn't be verified right now. This is not the same as an empty catalog.`, `현재 기본 ${what} 목록을 확인할 수 없습니다. 빈 목록과는 다릅니다.`)}
        </p>
        {status === 'unavailable' && <button type="button" className="arw-button mt-3" onClick={retry} disabled={refreshing}>{refreshing ? L('Checking…', '확인 중…') : L('Check again', '다시 확인')}</button>}
      </div>
    </div>
  );
}

function Empty({ kind }: { kind: 'faces' | 'voices' }) {
  const L = useL();
  return (
    <div className="px-6 py-10 text-center text-sm text-muted-foreground" data-testid={`empty-stock-${kind}`}>
      {kind === 'faces'
        ? L('No verified stock faces were found in the provider catalog.', '제공자 목록에서 확인된 기본 얼굴이 없습니다.')
        : L('No verified stock voices were found in the provider catalog.', '제공자 목록에서 확인된 기본 음성이 없습니다.')}
    </div>
  );
}

function FacesPanel({ projectId, provider, uid }: { projectId: string; provider: { id: WorkspaceStockProvider; name: string }; uid: string }) {
  const L = useL();
  const q = useGetWorkspaceStockFaces(projectId, provider.id, {
    query: { queryKey: [...getGetWorkspaceStockFacesQueryKey(projectId, provider.id), uid], enabled: !!projectId && uid !== 'anon', staleTime: 60000, retry: false },
  });
  const d = q.data;
  return (
    <Panel
      title={<span className="flex items-center gap-1.5"><UserRound className="h-3 w-3" />{provider.name} / {L('faces', '얼굴')}</span>}
      aside={d?.status === 'available' ? <span className="mono text-[10.5px] text-muted-foreground" data-testid={`count-faces-${provider.id}`}>{d.items.length}</span> : null}
    >
      <div aria-busy={q.isFetching} aria-live="polite">
        {q.isLoading ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skel key={i} className="aspect-[4/5]" />)}</div>
        ) : q.isError ? (
          <div className="p-4"><ErrorState onRetry={() => q.refetch()} message={L('Could not load stock faces.', '기본 얼굴 목록을 불러오지 못했습니다.')} /></div>
        ) : !d ? null : d.status !== 'available' ? (
          <StatusBody status={d.status} kind="faces" retry={() => void q.refetch()} refreshing={q.isFetching} />
        ) : !d.items.length ? (
          <Empty kind="faces" />
        ) : (
          <ul className="grid max-h-[520px] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
            {d.items.map((f) => <FaceCard key={JSON.stringify([f.id, f.thumbnailUrl])} f={f} />)}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function FaceCard({ f }: { f: WorkspaceStockFace }) {
  const L = useL();
  const [broken, setBroken] = useState(false);
  const show = !!f.thumbnailUrl && !broken;
  return (
    <li className="overflow-hidden rounded border bg-background" data-testid={`card-stock-face-${f.id}`}>
      <div className="relative aspect-[4/5] bg-muted">
        {show ? (
          <img src={f.thumbnailUrl!} alt={f.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground" role="img" aria-label={L(`No preview for ${f.name}`, `${f.name} 미리보기 없음`)}>
            <div className="flex flex-col items-center gap-1"><ImageOff className="h-6 w-6" /><span className="mono text-[10px] uppercase">{L('No preview', '미리보기 없음')}</span></div>
          </div>
        )}
      </div>
      <div className="space-y-1.5 p-2">
        <div className="truncate text-sm font-medium" title={f.name}>{f.name}</div>
        <div className="mono truncate text-[10px] text-muted-foreground" title={f.id}>{f.id}</div>
        <SelectionPill s={f.selection} />
      </div>
    </li>
  );
}

function VoicesPanel({ projectId, provider, uid }: { projectId: string; provider: { id: WorkspaceStockProvider; name: string }; uid: string }) {
  const L = useL();
  const [shown, setShown] = useState(VOICE_PAGE_SIZE);
  const [filters, setFilters] = useState(DEFAULT_STOCK_VOICE_FILTERS);
  const listRef = useRef<HTMLUListElement>(null);
  const q = useGetWorkspaceStockVoices(projectId, provider.id, {
    query: { queryKey: [...getGetWorkspaceStockVoicesQueryKey(projectId, provider.id), uid], enabled: !!projectId && uid !== 'anon', staleTime: 60000, retry: false },
  });
  const d = q.data;
  const canFilter = provider.id === 'anam';
  const voices = d?.status === 'available' ? d.items : undefined;
  const showFilters = canFilter && !q.isError && !!voices?.length;
  const matches = useMemo(() => voices && canFilter ? filterStockVoices(voices, filters) : voices, [voices, canFilter, filters]);
  function updateFilters(next: StockVoiceFilters) {
    setFilters(next);
    setShown(VOICE_PAGE_SIZE);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  return (
    <Panel
      title={<span className="flex items-center gap-1.5"><AudioLines className="h-3 w-3" />{provider.name} / {L('voices', '음성')}</span>}
      aside={d?.status === 'available' ? <span className="mono text-[10.5px] text-muted-foreground" data-testid={`count-voices-${provider.id}`}>{d.items.length}</span> : null}
    >
      <div aria-busy={q.isFetching}>
        {showFilters && (
          <VoiceFilters voices={voices} filters={filters} onChange={updateFilters} />
        )}
        <div aria-live={showFilters ? undefined : 'polite'}>
          {q.isLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skel key={i} className="h-12" />)}</div>
          ) : q.isError ? (
            <div className="p-4"><ErrorState onRetry={() => q.refetch()} message={L('Could not load stock voices.', '기본 음성 목록을 불러오지 못했습니다.')} /></div>
          ) : !d ? null : d.status !== 'available' ? (
            <StatusBody status={d.status} kind="voices" retry={() => void q.refetch()} refreshing={q.isFetching} />
          ) : !voices?.length || !matches ? (
            <Empty kind="voices" />
          ) : (
            <>
              {canFilter && (
                <p role="status" className="px-4 pb-3 text-xs text-muted-foreground" data-testid="text-stock-voice-matches">
                  {L(`${matches.length} of ${voices.length} loaded voices match`, `불러온 음성 ${voices.length}개 중 ${matches.length}개 일치`)}
                </p>
              )}
              {matches.length === 0 ? (
                <p className="border-t px-6 py-10 text-center text-sm text-muted-foreground" data-testid="empty-stock-voice-search">
                  {L('No voices match. Try another name or clear the filters.', '검색 조건에 맞는 음성이 없습니다. 다른 이름을 검색하거나 필터를 초기화해 보세요.')}
                </p>
              ) : (
                <ul ref={listRef} className="max-h-[420px] divide-y overflow-y-auto">
                  {matches.slice(0, shown).map((v) => <VoiceRow key={v.id} v={v} />)}
                </ul>
              )}
              {matches.length > VOICE_PAGE_SIZE && <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                <span className="text-xs text-muted-foreground">{L(`${Math.min(shown, matches.length)} of ${matches.length} voices shown`, `음성 ${matches.length}개 중 ${Math.min(shown, matches.length)}개 표시`)}</span>
                {matches.length > shown && <button type="button" className="arw-button" data-testid={`button-show-more-voices-${provider.id}`} onClick={() => setShown(n => n + VOICE_PAGE_SIZE)}>{L('Show more voices', '음성 더 보기')}</button>}
              </div>}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function useVoiceFilterLabels() {
  const L = useL();
  return {
    genders: {
      male: L('Male', '남성'), female: L('Female', '여성'),
      neutral: L('Neutral (classified)', '중성 (분류됨)'), unclassified: L('Unclassified', '미분류'),
    },
    unknownLanguage: L('Language unknown', '언어 미상'),
  };
}

function VoiceFilters({ voices, filters, onChange }: {
  voices: readonly WorkspaceStockVoice[]; filters: StockVoiceFilters; onChange: (next: StockVoiceFilters) => void;
}) {
  const L = useL();
  const { lang } = useI18n();
  const { genders, unknownLanguage } = useVoiceFilterLabels();
  const languages = useMemo(() => stockVoiceLanguages(voices, lang), [voices, lang]);
  // Keep the selection visible if a refetch removes that language from the catalog.
  const selectedLanguage = filters.language.startsWith('language:') ? filters.language.slice('language:'.length) : null;
  const fieldClass = 'w-full min-w-0 rounded border bg-background px-2.5 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="space-y-2 p-4 pb-2">
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>{L('Search voice names', '음성 이름 검색')}</span>
        <input type="search" className={fieldClass} data-testid="input-stock-voice-search" value={filters.name}
          onChange={event => onChange({ ...filters, name: event.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
          <span>{L('Gender', '성별')}</span>
          <select className={fieldClass} data-testid="select-stock-voice-gender" value={filters.gender}
            onChange={event => onChange({ ...filters, gender: event.target.value as StockVoiceFilters['gender'] })}>
            <option value="all">{L('All genders', '모든 성별')}</option>
            {STOCK_VOICE_GENDERS.map(gender => <option key={gender} value={gender}>{genders[gender]}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
          <span>{L('Language', '언어')}</span>
          <select className={fieldClass} data-testid="select-stock-voice-language" value={filters.language}
            onChange={event => onChange({ ...filters, language: event.target.value as StockVoiceFilters['language'] })}>
            <option value="all">{L('All languages', '모든 언어')}</option>
            <option value="unknown">{unknownLanguage}</option>
            {selectedLanguage !== null && !languages.includes(selectedLanguage) && <option value={filters.language}>{selectedLanguage}</option>}
            {languages.map(language => <option key={language} value={`language:${language}`}>{language}</option>)}
          </select>
        </label>
      </div>
      <button type="button" className="arw-button" data-testid="button-clear-stock-voice-filters"
        disabled={!filters.name && filters.gender === 'all' && filters.language === 'all'}
        onClick={() => onChange(DEFAULT_STOCK_VOICE_FILTERS)}>{L('Clear filters', '검색 조건 초기화')}</button>
    </div>
  );
}

function VoiceRow({ v }: { v: WorkspaceStockVoice }) {
  const L = useL();
  const { genders, unknownLanguage } = useVoiceFilterLabels();
  const src = v.genderSource === 'provider' ? L('provider-supplied', '프로바이더 제공')
    : v.genderSource === 'admin' ? L('set by admin', '관리자 지정') : L('source unknown', '출처 미상');
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-stock-voice-${v.id}`}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{v.name}</div>
        <div className="mono truncate text-[10px] text-muted-foreground">{v.id}</div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-sm border px-1.5 py-0.5" data-testid={`text-voice-gender-${v.id}`}>
          {genders[v.gender]}{v.gender !== 'unclassified' && <span className="text-muted-foreground"> / {src}</span>}
        </span>
        {v.languages.length ? v.languages.map((l) => <span key={l} className="mono rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px]">{l}</span>)
          : <span className="mono rounded-sm border border-dashed px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{unknownLanguage}</span>}
        <SelectionPill s={v.selection} />
      </div>
    </li>
  );
}
