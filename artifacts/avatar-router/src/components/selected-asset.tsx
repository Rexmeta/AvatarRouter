import { Link } from 'wouter';
import { useEffect } from 'react';
import { useUser } from '@clerk/react';
import { useGetAvatarAsset, getGetAvatarAssetQueryKey, type AvatarAsset } from '@workspace/api-client-react';
import { Lock, Radio, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { setSelectedAsset, useSelectedAsset } from '@/lib/selected-asset';
import { Pill, Skel, errMsg } from '@/components/bits';

const PENDING = new Set(['queued', 'submitting', 'processing', 'deleting']);

/** Server-validated view of the locally selected asset. Only `ready` records are usable. */
export function useValidatedSelectedAsset() {
  const sel = useSelectedAsset();
  const { user, isLoaded } = useUser();
  const id = sel?.id ?? '';
  const q = useGetAvatarAsset(id, {
    query: {
      queryKey: [...getGetAvatarAssetQueryKey(id), user?.id],
      enabled: isLoaded && !!user && !!id,
      staleTime: 10000,
      retry: false,
      refetchInterval: (s) => (s.state.data && PENDING.has(s.state.data.status) ? 4000 : false),
    },
  });
  const status = (q.error as { status?: number } | null)?.status;
  const notFound = q.isError && (status === 404 || status === 403);
  useEffect(() => {
    if (sel && (notFound || q.data?.status === 'deleted')) setSelectedAsset(null);
  }, [sel, notFound, q.data?.status]);
  const record: AvatarAsset | undefined = q.data && q.data.id === id ? q.data : undefined;
  const ready = !!record && record.status === 'ready' && !!record.providerAvatarId;
  return { sel, record, ready, query: q, signedIn: !!user };
}

export function SelectedAssetPanel({ onRequestLive, pending, liveError }: { onRequestLive?: (r: AvatarAsset) => void; pending?: boolean; liveError?: string | null }) {
  const { sel: a, record, ready, query, signedIn } = useValidatedSelectedAsset();
  const { lang } = useI18n();
  const L = (en: string, ko: string) => (lang === 'en' ? en : ko);
  if (!a || !signedIn) {
    return (
      <div className="rise mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground" data-testid="panel-no-asset">
        <span>{L('No provisioned avatar asset selected. The targets below use catalog avatars.', '선택된 프로비저닝 아바타 에셋이 없습니다. 아래 대상은 카탈로그 아바타를 사용합니다.')}</span>
        <Link href="/avatar-assets" data-testid="link-choose-asset" className="mono text-xs text-primary underline-offset-4 hover:underline">{L('Choose from avatar assets', '아바타 에셋에서 선택')}</Link>
      </div>
    );
  }
  return (
    <section className="rise mb-6 overflow-hidden rounded-md border border-card-border bg-card shadow-sm" data-testid="panel-selected-asset">
      <div className="grid gap-0 md:grid-cols-[120px_1fr]">
        <div className="relative bg-muted">
          <img src={`/api/v1/assets/images/${a.imageAssetId}/content`} alt="" className="h-full max-h-40 w-full object-cover opacity-80 grayscale-[35%]" />
          <span className="mono absolute bottom-1 left-1 rounded-sm bg-background/85 px-1 text-[9px] uppercase tracking-wider">{L('source still', '원본 정지 이미지')}</span>
        </div>
        <div className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="eyebrow">{L('Selected avatar asset', '선택된 아바타 에셋')}</div>
              <div className="text-lg font-semibold" data-testid="text-selected-asset-name">{record?.name ?? a.name}</div>
              <div className="mono text-[11px] text-muted-foreground">{record?.providerId ?? a.providerId} · {record?.providerAvatarId ?? '—'}</div>
            </div>
            <div className="flex items-center gap-2">
              {query.isLoading ? <Skel className="h-5 w-20" /> : query.isError ? <Pill value="error" label={L('unavailable', '사용 불가')} />
                : record ? <Pill value={ready ? 'ready' : record.status === 'failed' ? 'failed' : 'pending'} label={record.status.replace('_', ' ')} live={PENDING.has(record.status)} /> : null}
              <Pill value={record?.liveValidation?.status === 'validated' ? 'available' : 'pending'} label={record?.liveValidation?.status === 'validated' ? L('playback reported', '재생 확인 기록 있음') : L('live unverified', '라이브 미검증')} />
              <button data-testid="button-clear-asset" onClick={() => setSelectedAsset(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="clear"><X className="h-4 w-4" /></button>
            </div>
          </div>
          {query.isError && <p className="mt-3 text-sm text-destructive" data-testid="text-asset-load-error">{errMsg(query.error)}</p>}
          {record && !ready && (
            <p className="mt-3 text-sm text-[hsl(var(--warn))]" data-testid="text-asset-not-ready">
              {L(`Current status is ${record.status}. Only ready assets with a provider avatar ID can be requested; this selection is not usable now.`, `현재 상태는 ${record.status}입니다. 프로바이더 아바타 ID가 있는 ready 에셋만 요청할 수 있어 지금은 사용할 수 없습니다.`)}
            </p>
          )}
          <div className="mt-3 flex gap-2 rounded border border-[hsl(var(--warn)/.35)] bg-[hsl(var(--warn)/.06)] p-3 text-[13px]" data-testid="text-live-unavailable">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warn))]" />
            <p>
              {L(
                'Ready only means provisioned. Tavus assets can run in the cost-approved live panel above; unvalidated assets start in validation mode. Only report success after real video and returned audio. Anam live runtime is unavailable. This source still is not a live preview.',
                'Ready는 생성 완료만 의미합니다. Tavus는 위 라이브 패널에서 비용 동의 후 실행할 수 있으며 미검증 자산은 검증 모드로 시작합니다. 실제 영상과 반환 음성을 확인한 뒤에만 성공을 기록하세요. Anam 라이브는 미지원입니다. 이 원본 정지 이미지는 라이브 미리보기가 아닙니다.',
              )}
            </p>
          </div>
          {onRequestLive && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button data-testid="button-request-live-asset" disabled={!ready || !record || pending} onClick={() => record && onRequestLive(record)}
                className="inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted active:scale-[.97] disabled:opacity-40">
                <Radio className="h-3.5 w-3.5" /> {pending ? '…' : L('Check live availability', '라이브 가능 여부 확인')}
              </button>
              <span className="text-[11px] text-muted-foreground">{L('Opens the live controls. Does not start or bill a session.', '라이브 조작 패널로 이동합니다. 세션 시작이나 과금은 하지 않습니다.')}</span>
            </div>
          )}
          {liveError && <p className="mono mt-2 rounded border border-[hsl(var(--warn)/.4)] bg-[hsl(var(--warn)/.06)] p-2 text-xs" data-testid="text-asset-live-error">{liveError}</p>}
        </div>
      </div>
    </section>
  );
}
