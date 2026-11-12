import { useState } from 'react';
import { useUser } from '@clerk/react';
import { useGetSeedLiveOptions, getGetSeedLiveOptionsQueryKey } from '@workspace/api-client-react';
import { useAssetWorkspace } from '@/lib/workspace-assets';
import { useI18n } from '@/lib/i18n';
import { ErrorState, errMsg } from '@/components/bits';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const labels: Record<string, [string, string]> = {
  select: ['Ready to select after rechecking on save', '저장 시 재확인 후 라이브 선택 가능'],
  provision: ['Create a face with explicit cost consent', '비용 동의 후 얼굴 생성'],
  validate: ['Playback validation required', '실제 영상·음성 재생 검증 필요'],
  wait: ['Creation queued or processing; do not create again', '생성 대기·처리 중 — 재생성하지 마세요'],
  reconcile: ['Check existing creation result; do not retry', '기존 생성 결과 확인 필요 — 재시도 금지'],
  review_consent: ['Independent consent review required', '실존 인물 동의 검토 필요'],
  configure_provider: ['Operator must configure the Tavus key', '운영자의 Tavus 키 설정 필요'],
  inspect_failure: ['Inspect the existing failure before any new creation', '새 생성 전에 기존 실패 원인 확인'],
  replace_image: ['This reference is unavailable; select another image/version', '사용 불가 — 다른 이미지·버전을 선택하세요'],
};

export function SeedLiveOptionsButton({ imageId, onProvision }: { imageId: string; onProvision: () => void }) {
  const [open, setOpen] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const { request, projectId } = useAssetWorkspace();
  const { user } = useUser();
  const { lang } = useI18n();
  const ko = lang === 'ko';
  const q = useGetSeedLiveOptions(imageId, {
    request,
    query: {
      queryKey: [...getGetSeedLiveOptionsQueryKey(imageId), projectId, user?.id],
      enabled: open && !!user, staleTime: 0, refetchInterval: open ? 4000 : false,
    },
  });
  const text = (value: string) => labels[value]?.[ko ? 1 : 0] ?? value;
  return <>
    <button className="w-full rounded border px-3 py-1.5 text-xs hover:bg-muted"
      data-testid={`button-seed-live-${imageId}`} onClick={() => { setCopyError(false); setOpen(true); }}>
      {ko ? 'RoleplayX · 시드 이미지 라이브 설정' : 'RoleplayX · seed image live setup'}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ko ? '시드 이미지 → 라이브 페르소나' : 'Seed image → live persona'}</DialogTitle>
          <DialogDescription>{ko
            ? '현재 프로젝트의 동일 이미지에 연결된 Tavus 자산만 표시합니다. 이 조회와 설정 복사는 유료 생성·통화를 시작하지 않습니다.'
            : 'Only Tavus assets for this exact image and project are shown. Reading or copying settings never starts creation or a call.'}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <p>{ko ? '상태 확인 중…' : 'Checking…'}</p>}
        {q.isError && <ErrorState onRetry={() => q.refetch()} message={errMsg(q.error)} />}
        {q.data && <div className="space-y-3 text-sm">
          <p className="rounded border p-3" data-testid="seed-live-next-action">{text(q.data.nextAction)}</p>
          <p className="break-all text-xs text-muted-foreground">{q.data.imageAssetId} · v{q.data.imageVersion}</p>
          {q.data.candidates.map(candidate => <div key={candidate.avatarAssetId} className="space-y-2 rounded border p-3">
            <p className="break-all font-mono text-xs">{candidate.avatarAssetId}</p>
            <p>{text(candidate.nextAction)}</p>
            {candidate.liveReference && <button className="rounded border px-3 py-1.5" onClick={async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify({
                  seedImageAssetId: imageId, avatarMode: 'live', liveAvatar: candidate.liveReference,
                }, null, 2));
                setCopyError(false);
              } catch { setCopyError(true); }
            }}>{ko ? '페르소나 연결 설정 예시 복사' : 'Copy example persona binding'}</button>}
          </div>)}
          {copyError && <p role="alert">{ko ? '클립보드 복사에 실패했습니다.' : 'Clipboard copy failed.'}</p>}
          {q.data.canProvision && <button className="rounded bg-foreground px-3 py-2 text-background"
            onClick={() => { setOpen(false); onProvision(); }}>{ko ? '생성 설정 열기 — 아직 과금하지 않음' : 'Open creation settings — no charge yet'}</button>}
          <p className="text-xs text-muted-foreground">{ko
            ? '생성 완료는 재생 검증이 아닙니다. 시드 이미지 변경 시 연결을 해제하고 새 이미지로 다시 확인하세요. RoleplayX 서버에서 저장 권한과 상태를 재확인해야 합니다.'
            : 'Provisioned is not playback-verified. Clear the binding when the seed changes. RoleplayX must recheck permissions and status on save.'}</p>
          <a className="text-primary underline" href={`${import.meta.env.BASE_URL}roleplayx/persona-seed-live.md`} target="_blank" rel="noreferrer">
            {ko ? '페르소나 편집기 적용 가이드' : 'Persona editor integration guide'}
          </a>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
