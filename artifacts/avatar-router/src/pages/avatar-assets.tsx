import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { AlertTriangle, ArrowUpRight, ExternalLink, FlaskConical, ImageUp, Link2, LogIn, ShieldAlert, Trash2, UserRound, Wand2 } from 'lucide-react';
import {
  useListProvisioningProviders, useListImageAssets, useListAvatarAssets, useIngestImage, useDeleteImageAsset,
  useProvisionAvatar, useGetAvatarAsset, useDeleteAvatarAsset,
  getListProvisioningProvidersQueryKey, getListImageAssetsQueryKey, getListAvatarAssetsQueryKey, getGetAvatarAssetQueryKey,
  type ImageAsset, type AvatarAsset, type ProvisioningProvider,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { ErrorState, PageHead, Panel, Pill, Skel, errMsg, fmtTime } from '@/components/bits';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { setSelectedAsset, useSelectedAsset } from '@/lib/selected-asset';
import { cn } from '@/lib/utils';

const MAX_BYTES = 4.5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PENDING = new Set(['queued', 'submitting', 'processing', 'deleting']);
const STEPS = ['queued', 'submitting', 'processing', 'ready'] as const;
const imgSrc = (id: string) => `/api/v1/assets/images/${id}/content`;
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

function useL() {
  const { lang } = useI18n();
  return (en: string, ko: string) => (lang === 'en' ? en : ko);
}

export default function AvatarAssets() {
  const { user, isLoaded } = useUser();
  const L = useL();
  const head = (
    <PageHead
      index="02b / avatar assets"
      title={L('Avatar assets', '아바타 에셋')}
      lede={L(
        'Ingest a source image you hold rights to, then ask a provider to build a reusable avatar from it. Every state here is what the server and provider actually report.',
        '권리를 보유한 원본 이미지를 업로드하고 프로바이더에 재사용 가능한 아바타 생성을 요청하세요. 여기의 모든 상태는 서버와 프로바이더가 실제로 보고한 값입니다.',
      )}
    />
  );
  if (!isLoaded) return <div>{head}<div className="grid gap-6 lg:grid-cols-2"><Skel className="h-80" /><Skel className="h-80" /></div></div>;
  if (!user) {
    return (
      <div>
        {head}
        <SignedOutGate />
        <div className="mt-8"><CapabilityPanel /></div>
      </div>
    );
  }
  return <SignedIn head={head} />;
}

function SignedOutGate() {
  const L = useL();
  return (
    <Panel className="overflow-hidden">
      <div className="grid md:grid-cols-[1fr_auto]">
        <div className="p-6">
          <div className="eyebrow mb-2">{L('Private workspace', '비공개 작업 공간')}</div>
          <h2 className="text-xl font-semibold">{L('Sign in to see your images and avatars.', '이미지와 아바타를 보려면 로그인하세요.')}</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            {L('Uploads are scoped to your account and never listed publicly. Provider capabilities below are public.', '업로드는 계정 단위로 격리되며 공개되지 않습니다. 아래 프로바이더 기능 정보는 공개입니다.')}
          </p>
          <div className="mt-5 flex gap-2">
            <Link href="/sign-in" data-testid="link-gate-sign-in" className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97]">
              <LogIn className="h-4 w-4" /> {L('Sign in', '로그인')}
            </Link>
            <Link href="/sign-up" data-testid="link-gate-sign-up" className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm transition hover:bg-muted">
              {L('Create account', '계정 만들기')}
            </Link>
          </div>
        </div>
        <div className="hidden items-center border-l bg-muted/50 px-10 md:flex">
          <ImageUp className="h-16 w-16 text-muted-foreground/40" strokeWidth={1} />
        </div>
      </div>
    </Panel>
  );
}

function SignedIn({ head }: { head: ReactNode }) {
  const { user } = useUser();
  const L = useL();
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const [provisionFor, setProvisionFor] = useState<ImageAsset | null>(null);

  const images = useListImageAssets({
    query: {
      queryKey: getListImageAssetsQueryKey(),
      enabled: !!user,
      staleTime: 15000,
    },
  });
  const avatars = useListAvatarAssets({
    query: {
      queryKey: getListAvatarAssetsQueryKey(),
      enabled: !!user,
      staleTime: 3000,
      refetchInterval: (q) => ((q.state.data ?? []).some((a) => PENDING.has(a.status)) ? 4000 : false),
    },
  });

  return (
    <div>
      {head}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <IngestPanel images={images.data ?? []} />
        <Panel title={L('Private image library', '비공개 이미지 라이브러리')} aside={<span className="mono text-[10.5px] text-muted-foreground">{images.data?.length ?? 0}</span>}>
          {images.isLoading ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-52" />)}</div>
          ) : images.isError ? (
            <div className="p-4"><ErrorState onRetry={() => images.refetch()} message={errMsg(images.error)} /></div>
          ) : !images.data?.length ? (
            <div className="flex flex-col items-center px-6 py-14 text-center" data-testid="empty-images">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-full border border-dashed"><ImageUp className="h-6 w-6 text-muted-foreground" /></div>
              <div className="font-semibold">{L('No source images yet', '원본 이미지가 아직 없습니다')}</div>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">{L('Upload a JPEG, PNG or WebP on the left. It is re-encoded server-side and only visible to you.', '왼쪽에서 JPEG, PNG, WebP를 업로드하세요. 서버에서 재인코딩되며 본인만 볼 수 있습니다.')}</p>
            </div>
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {images.data.map((img) => <ImageCard key={img.id} img={img} onProvision={() => setProvisionFor(img)} avatars={avatars.data ?? []} />)}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-8">
        <Panel title={L('Provisioned avatars', '프로비저닝된 아바타')} aside={avatars.isFetching ? <span className="mono text-[10.5px] text-muted-foreground">{L('syncing', '동기화 중')}</span> : null}>
          {avatars.isLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skel key={i} className="h-14" />)}</div>
          ) : avatars.isError ? (
            <div className="p-4"><ErrorState onRetry={() => avatars.refetch()} message={errMsg(avatars.error)} /></div>
          ) : !avatars.data?.length ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground" data-testid="empty-avatars">
              {L('No avatars requested. Choose "Provision" on an image to start one.', '요청된 아바타가 없습니다. 이미지에서 "프로비저닝"을 선택하세요.')}
            </div>
          ) : (
            <ul className="divide-y">
              {avatars.data.map((a) => <AvatarRow key={a.id} a={a} onOpen={() => setLocation(`/avatar-assets/${a.id}`)} />)}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-8"><CapabilityPanel /></div>

      <ProvisionDialog img={provisionFor} onClose={() => setProvisionFor(null)} />
      <AvatarDetailSheet id={params.id ?? ''} onClose={() => setLocation('/avatar-assets')} />
    </div>
  );
}

/* ---------------- ingest ---------------- */

function IngestPanel({ images }: { images: ImageAsset[] }) {
  const L = useL();
  const { toast } = useToast();
  const qc = useQueryClient();
  const ingest = useIngestImage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [name, setName] = useState('');
  const [b64, setB64] = useState('');
  const [preview, setPreview] = useState('');
  const [fileInfo, setFileInfo] = useState('');
  const [url, setUrl] = useState('');
  const [prev, setPrev] = useState('');
  const [likeness, setLikeness] = useState<'synthetic' | 'real_person'>('synthetic');
  const [consent, setConsent] = useState('');
  const [rights, setRights] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickFile = (f?: File) => {
    setErr(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) { setErr(L('Only JPEG, PNG or WebP.', 'JPEG, PNG, WebP만 가능합니다.')); return; }
    if (f.size > MAX_BYTES) { setErr(L(`File is ${kb(f.size)}; limit is 4.5 MB.`, `파일 크기 ${kb(f.size)}; 제한은 4.5MB입니다.`)); return; }
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      setPreview(s);
      setB64(s.slice(s.indexOf(',') + 1));
      setFileInfo(`${f.type.split('/')[1].toUpperCase()} · ${kb(f.size)}`);
      if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 80));
    };
    r.readAsDataURL(f);
  };

  const urlOk = /^https:\/\/[^\s]+$/i.test(url.trim());
  const sourceOk = mode === 'file' ? !!b64 : urlOk;
  const canSubmit = name.trim().length > 0 && sourceOk && rights && !ingest.isPending;

  const reset = () => {
    setName(''); setB64(''); setPreview(''); setFileInfo(''); setUrl(''); setPrev(''); setConsent(''); setRights(false); setLikeness('synthetic');
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = () => {
    setErr(null);
    ingest.mutate(
      {
        data: {
          name: name.trim(),
          ...(mode === 'file' ? { imageBase64: b64 } : { sourceUrl: url.trim() }),
          rightsConfirmed: true,
          likeness,
          ...(consent.trim() ? { consentReference: consent.trim() } : {}),
          ...(prev ? { previousVersionId: prev } : {}),
        },
      },
      {
        onSuccess: (img) => {
          qc.invalidateQueries({ queryKey: getListImageAssetsQueryKey() });
          toast({ title: L('Image ingested', '이미지 업로드됨'), description: `${img.name} · v${img.version} · ${img.width}x${img.height}` });
          reset();
        },
        onError: (e) => setErr(errMsg(e)),
      },
    );
  };

  return (
    <Panel title={L('Ingest source image', '원본 이미지 업로드')}>
      <div className="space-y-4 p-4">
        <div className="mono flex rounded border p-0.5 text-[11px]" role="tablist">
          {(['file', 'url'] as const).map((m) => (
            <button key={m} data-testid={`button-source-${m}`} onClick={() => { setMode(m); setErr(null); }}
              className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 uppercase tracking-wider transition', mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
              {m === 'file' ? <ImageUp className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {m === 'file' ? L('Upload', '업로드') : 'HTTPS URL'}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <label
            className={cn('group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center overflow-hidden rounded border border-dashed bg-muted/40 transition hover:border-primary', preview && 'border-solid')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}
          >
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" data-testid="input-file" onChange={(e) => pickFile(e.target.files?.[0])} />
            {preview ? (
              <>
                <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <span className="mono absolute bottom-2 left-2 rounded-sm bg-background/90 px-1.5 py-0.5 text-[10px]">{fileInfo}</span>
              </>
            ) : (
              <>
                <ImageUp className="h-7 w-7 text-muted-foreground transition group-hover:-translate-y-0.5" />
                <span className="mt-2 text-sm font-medium">{L('Drop or choose an image', '이미지를 끌어오거나 선택')}</span>
                <span className="mono mt-1 text-[10.5px] text-muted-foreground">JPEG · PNG · WebP · max 4.5 MB</span>
              </>
            )}
          </label>
        ) : (
          <Field label={L('Source URL', '원본 URL')} hint={L('HTTPS only, on a hostname the operator has allowlisted. Others are rejected by the server.', 'HTTPS 전용이며 운영자가 허용한 호스트만 가능합니다. 그 외는 서버가 거부합니다.')}>
            <input data-testid="input-source-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="w-full rounded border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            {url && !urlOk && <p className="mt-1 text-xs text-destructive">{L('Must start with https://', 'https://로 시작해야 합니다')}</p>}
          </Field>
        )}

        <Field label={L('Name', '이름')}>
          <input data-testid="input-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        </Field>

        <Field label={L('New version of', '다음의 새 버전')} hint={L('Optional. Links this upload to an earlier image as its next version.', '선택 사항. 이전 이미지의 다음 버전으로 연결합니다.')}>
          <select data-testid="select-previous-version" value={prev} onChange={(e) => setPrev(e.target.value)} className="w-full rounded border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
            <option value="">{L('None — new lineage', '없음 — 새 계보')}</option>
            {images.map((i) => <option key={i.id} value={i.id}>{i.name} · v{i.version}</option>)}
          </select>
        </Field>

        <div>
          <div className="eyebrow mb-2">{L('Likeness', '초상 유형')}</div>
          <div className="grid grid-cols-2 gap-2">
            {([['synthetic', Wand2, L('Synthetic', '합성'), L('Generated or fictional face', '생성되거나 가상의 얼굴')], ['real_person', UserRound, L('Real person', '실존 인물'), L('Identifiable human', '식별 가능한 사람')]] as const).map(([v, Icon, title, sub]) => (
              <button key={v} type="button" data-testid={`button-likeness-${v}`} onClick={() => setLikeness(v)}
                className={cn('rounded border p-3 text-left transition active:scale-[.98]', likeness === v ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                <Icon className={cn('mb-1.5 h-4 w-4', likeness === v ? 'text-primary' : 'text-muted-foreground')} />
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-[11px] text-muted-foreground">{sub}</div>
              </button>
            ))}
          </div>
        </div>

        {likeness === 'real_person' && (
          <div className="rounded border border-[hsl(var(--warn)/.4)] bg-[hsl(var(--warn)/.06)] p-3 text-[12.5px]" data-testid="note-real-person">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><ShieldAlert className="h-4 w-4 text-[hsl(var(--warn))]" /> {L('Held for operator review', '운영자 검토 대기')}</div>
            {L(
              'Real-person images are stored with consent status pending_review. The server refuses to create an avatar from them until an operator verifies the consent evidence. Provide the reference your application holds.',
              '실존 인물 이미지는 pending_review 동의 상태로 저장됩니다. 운영자가 동의 증빙을 확인하기 전까지 서버는 아바타 생성을 거부합니다. 애플리케이션이 보관 중인 증빙 참조를 입력하세요.',
            )}
          </div>
        )}

        <Field label={L('Consent evidence reference', '동의 증빙 참조')} hint={L('Your record ID for the consent, e.g. a signed release. Not a verification of identity.', '서명된 동의서 등 동의 기록 ID. 신원 검증이 아닙니다.')}>
          <input data-testid="input-consent-reference" maxLength={200} value={consent} onChange={(e) => setConsent(e.target.value)} placeholder={likeness === 'real_person' ? 'release-2024-0193' : L('optional', '선택')} className="w-full rounded border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5 rounded border bg-muted/40 p-3 text-[12.5px]">
          <input type="checkbox" data-testid="checkbox-rights" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
          <span>{L('I own this image or hold the rights to use it for avatar creation, including any likeness it depicts.', '이 이미지를 소유하거나 아바타 생성에 사용할 권리(초상권 포함)를 보유하고 있습니다.')}</span>
        </label>

        {err && <p className="flex gap-1.5 text-sm text-destructive" data-testid="text-ingest-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}</p>}

        <button data-testid="button-ingest" disabled={!canSubmit} onClick={submit}
          className="w-full rounded bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition active:scale-[.98] disabled:opacity-40">
          {ingest.isPending ? L('Uploading and re-encoding…', '업로드 및 재인코딩 중…') : L('Ingest image', '이미지 업로드')}
        </button>
      </div>
    </Panel>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ---------------- image card ---------------- */

function consentLabel(s: string, L: (a: string, b: string) => string) {
  return s === 'not_required' ? L('consent n/a', '동의 불필요') : s === 'pending_review' ? L('pending review', '검토 대기') : L('consent verified', '동의 확인됨');
}

function ImageCard({ img, onProvision, avatars }: { img: ImageAsset; onProvision: () => void; avatars: AvatarAsset[] }) {
  const L = useL();
  const { toast } = useToast();
  const qc = useQueryClient();
  const del = useDeleteImageAsset();
  const [confirm, setConfirm] = useState(false);
  const linked = avatars.filter((a) => a.imageAssetId === img.id && a.status !== 'deleted').length;
  const blocked = img.consentStatus === 'pending_review';

  return (
    <article className="group overflow-hidden rounded border bg-background" data-testid={`card-image-${img.id}`}>
      <div className="relative aspect-[4/3] bg-muted">
        <img src={imgSrc(img.id)} alt={img.name} loading="lazy" className="h-full w-full object-cover" />
        <div className="absolute left-2 top-2 flex gap-1">
          <span className="mono rounded-sm bg-background/90 px-1.5 py-0.5 text-[10px]">v{img.version}</span>
          <span className="mono rounded-sm bg-background/90 px-1.5 py-0.5 text-[10px]">{img.likeness === 'synthetic' ? L('synthetic', '합성') : L('real person', '실존 인물')}</span>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold" data-testid={`text-image-name-${img.id}`}>{img.name}</div>
            <div className="mono truncate text-[10.5px] text-muted-foreground">{img.width}x{img.height} · {kb(img.byteLength)} · {img.contentHash.slice(0, 10)}</div>
          </div>
          <Pill value={img.consentStatus === 'pending_review' ? 'pending' : 'ok'} label={consentLabel(img.consentStatus, L)} />
        </div>
        {img.previousVersionId && <div className="mono text-[10.5px] text-muted-foreground">{L('supersedes', '이전 버전')} {img.previousVersionId.slice(0, 8)}</div>}
        {blocked && <p className="text-[11.5px] text-[hsl(var(--warn))]">{L('Avatar creation blocked until an operator verifies consent.', '운영자가 동의를 확인할 때까지 아바타 생성이 차단됩니다.')}</p>}
        <div className="flex gap-2 pt-1">
          <button data-testid={`button-provision-${img.id}`} onClick={onProvision} disabled={blocked}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition active:scale-[.97] disabled:opacity-35">
            <Wand2 className="h-3.5 w-3.5" /> {L('Provision', '프로비저닝')}
          </button>
          <button data-testid={`button-delete-image-${img.id}`} onClick={() => setConfirm(true)} className="rounded border px-2.5 text-destructive transition hover:bg-destructive/5" aria-label="delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{L('Delete this source image?', '이 원본 이미지를 삭제할까요?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {L('The stored image bytes are removed permanently and cannot be recovered.', '저장된 이미지가 영구 삭제되며 복구할 수 없습니다.')}
              {linked > 0 && ' ' + L(`${linked} avatar(s) were built from it; the server may refuse until they are deleted.`, `이 이미지로 만든 아바타 ${linked}개가 있어 먼저 삭제해야 할 수 있습니다.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-image">{L('Cancel', '취소')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-image"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => del.mutate({ id: img.id }, {
                onSuccess: () => { qc.invalidateQueries({ queryKey: getListImageAssetsQueryKey() }); toast({ title: L('Image deleted', '이미지 삭제됨') }); },
                onError: (e) => toast({ title: L('Delete failed', '삭제 실패'), description: errMsg(e), variant: 'destructive' }),
              })}
            >
              {L('Delete permanently', '영구 삭제')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

/* ---------------- provision ---------------- */

function providerBlock(p: ProvisioningProvider, L: (a: string, b: string) => string): string | null {
  if (!p.adapterEnabled) return L('Documented only — adapter not enabled in this deployment.', '문서화만 됨 — 이 배포에서 어댑터 비활성.');
  if (!p.configured) return L('Adapter present but provider credentials are not configured.', '어댑터는 있지만 프로바이더 자격 증명이 설정되지 않았습니다.');
  if (!p.imageCreation) return L('Provider does not create avatars from images.', '이미지로 아바타를 생성하지 않습니다.');
  return null;
}

function ProvisionDialog({ img, onClose }: { img: ImageAsset | null; onClose: () => void }) {
  const L = useL();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const providers = useListProvisioningProviders({ query: { queryKey: getListProvisioningProvidersQueryKey(), staleTime: 60000 } });
  const provision = useProvisionAvatar();
  const [pid, setPid] = useState('');
  const [voice, setVoice] = useState('anna');
  const [cost, setCost] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sel = providers.data?.find((p) => p.id === pid);
  const voiceOk = /^[a-zA-Z0-9_-]{1,50}$/.test(voice);
  const blocked = img?.consentStatus === 'pending_review';

  const close = () => { setPid(''); setCost(false); setErr(null); setVoice('anna'); onClose(); };

  const go = () => {
    if (!img || !sel) return;
    setErr(null);
    provision.mutate(
      { data: { imageAssetId: img.id, providerId: sel.id as 'anam' | 'tavus' | 'lemonslice' | 'simli', voiceName: voice, costConfirmed: true } },
      {
        onSuccess: (a) => {
          qc.invalidateQueries({ queryKey: getListAvatarAssetsQueryKey() });
          toast({ title: L('Provisioning queued', '프로비저닝 대기열 등록'), description: `${a.providerId} · ${a.status}` });
          close();
          setLocation(`/avatar-assets/${a.id}`);
        },
        onError: (e) => setErr(errMsg(e)),
      },
    );
  };

  return (
    <Dialog open={!!img} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{L('Provision avatar', '아바타 프로비저닝')}</DialogTitle>
          <DialogDescription>{img ? `${img.name} · v${img.version} · ${img.contentHash.slice(0, 12)}` : ''}</DialogDescription>
        </DialogHeader>
        {blocked ? (
          <p className="rounded border border-[hsl(var(--warn)/.4)] bg-[hsl(var(--warn)/.06)] p-3 text-sm">{L('Consent is pending operator review. The server will reject this request.', '동의가 운영자 검토 대기 중입니다. 서버가 요청을 거부합니다.')}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {providers.isLoading ? <Skel className="h-32" /> : providers.isError ? <ErrorState onRetry={() => providers.refetch()} /> : providers.data?.map((p) => {
                const why = providerBlock(p, L);
                return (
                  <button key={p.id} type="button" disabled={!!why} data-testid={`button-provider-${p.id}`} onClick={() => { setPid(p.id); setCost(false); }}
                    className={cn('flex w-full items-start gap-3 rounded border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55', pid === p.id ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', pid === p.id ? 'bg-primary' : 'bg-muted-foreground/40')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{p.name}</span>
                        <Pill value={why ? 'pending' : 'available'} label={why ? L('unavailable', '사용 불가') : (p.customTraining ? L('training', '학습') : L('one-shot', '원샷'))} />
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{why ?? p.requirements}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Field label={L('Voice name', '음성 이름')} hint={L('Letters, digits, - and _. Defaults to anna.', '영문, 숫자, -, _ 사용. 기본값 anna.')}>
              <input data-testid="input-voice" value={voice} onChange={(e) => setVoice(e.target.value)} className="mono w-full rounded border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </Field>
            {sel && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded border border-primary/40 bg-primary/5 p-3 text-[12.5px]">
                <input type="checkbox" data-testid="checkbox-cost" checked={cost} onChange={(e) => setCost(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                <span>
                  <strong>{L('Potential provider charges.', '프로바이더 요금 발생 가능.')}</strong>{' '}
                  {L(`${sel.name} may bill your account for avatar ${sel.customTraining ? 'training' : 'creation'}. AvatarRouter does not estimate or refund this cost. I confirm.`, `${sel.name}가 아바타 ${sel.customTraining ? '학습' : '생성'} 비용을 청구할 수 있습니다. AvatarRouter는 이 비용을 추정하거나 환불하지 않습니다. 확인합니다.`)}
                </span>
              </label>
            )}
            {err && <p className="flex gap-1.5 text-sm text-destructive" data-testid="text-provision-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}</p>}
            <button data-testid="button-submit-provision" disabled={!sel || !cost || !voiceOk || provision.isPending} onClick={go}
              className="w-full rounded bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition active:scale-[.98] disabled:opacity-40">
              {provision.isPending ? L('Submitting…', '제출 중…') : L('Request avatar from provider', '프로바이더에 아바타 요청')}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- avatars ---------------- */

function statusTone(s: string) {
  return s === 'ready' ? 'ready' : s === 'failed' ? 'failed' : s === 'deleted' ? 'ended' : s === 'reconciliation_required' ? 'degraded' : 'pending';
}

function Progress({ status }: { status: string }) {
  const idx = STEPS.indexOf(status as (typeof STEPS)[number]);
  const bad = status === 'failed' || status === 'reconciliation_required';
  return (
    <div className="flex items-center gap-1" aria-label={status}>
      {STEPS.map((s, i) => (
        <span key={s} className={cn('h-1.5 w-7 rounded-full transition', bad ? (i === 0 ? 'bg-destructive' : 'bg-muted') : idx >= i ? (i === idx && status !== 'ready' ? 'animate-pulse bg-primary' : 'bg-[hsl(var(--ok))]') : 'bg-muted')} />
      ))}
    </div>
  );
}

function AvatarRow({ a, onOpen }: { a: AvatarAsset; onOpen: () => void }) {
  const L = useL();
  return (
    <li>
      <button onClick={onOpen} data-testid={`row-avatar-${a.id}`} className="grid w-full grid-cols-[48px_1fr_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/60">
        <img src={imgSrc(a.imageAssetId)} alt="" className="h-12 w-12 rounded object-cover grayscale-[40%]" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{a.name}</div>
          <div className="mono flex flex-wrap gap-x-3 text-[10.5px] text-muted-foreground">
            <span>{a.providerId}</span><span>{a.creationMode}</span><span>{a.providerAvatarId ?? L('no provider id yet', '프로바이더 ID 없음')}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Pill value={statusTone(a.status)} label={a.status.replace('_', ' ')} live={PENDING.has(a.status)} />
          <Progress status={a.status} />
        </div>
      </button>
    </li>
  );
}

function AvatarDetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const L = useL();
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [confirm, setConfirm] = useState(false);
  const selected = useSelectedAsset();
  const q = useGetAvatarAsset(id, {
    query: {
      queryKey: getGetAvatarAssetQueryKey(id),
      enabled: !!user && !!id,
      staleTime: 3000,
      refetchInterval: (s) => (s.state.data && PENDING.has(s.state.data.status) ? 4000 : false),
    },
  });
  const del = useDeleteAvatarAsset();
  const a = q.data;
  const caps = useMemo(() => (a ? [
    [L('Reusable ID', '재사용 ID'), a.capabilities.reusable ? 'yes' : 'no'],
    [L('Live rendering', '라이브 렌더링'), a.capabilities.liveRendering ? 'yes' : 'no'],
    [L('Emotion control', '감정 제어'), a.capabilities.emotionControl],
    [L('Behavior control', '행동 제어'), a.capabilities.behaviorControl],
    [L('Validation', '검증'), a.capabilities.validation],
  ] : []), [a, L]);

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>{a?.name ?? L('Avatar asset', '아바타 에셋')}</SheetTitle></SheetHeader>
        {q.isLoading ? <div className="mt-6 space-y-3"><Skel className="h-48" /><Skel className="h-24" /></div>
          : q.isError ? <div className="mt-6"><ErrorState onRetry={() => q.refetch()} message={errMsg(q.error)} /></div>
          : a ? (
            <div className="mt-5 space-y-5" data-testid="panel-avatar-detail">
              <div className="relative overflow-hidden rounded border bg-muted">
                <img src={imgSrc(a.imageAssetId)} alt="" className="aspect-[4/3] w-full object-cover grayscale-[30%]" />
                <span className="mono absolute bottom-2 left-2 rounded-sm bg-background/90 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">{L('source still — not generated output', '원본 정지 이미지 — 생성 결과 아님')}</span>
              </div>
              <div className="flex items-center justify-between">
                <Pill value={statusTone(a.status)} label={a.status.replace('_', ' ')} live={PENDING.has(a.status)} />
                <Progress status={a.status} />
              </div>
              {PENDING.has(a.status) && <p className="text-xs text-muted-foreground">{L('Provider work is asynchronous. This view refreshes every 4 seconds.', '프로바이더 작업은 비동기입니다. 4초마다 새로 고칩니다.')}</p>}
              {a.errorCode && <p className="mono rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="text-avatar-error">{a.errorCode}</p>}
              {a.status === 'reconciliation_required' && <p className="text-xs text-[hsl(var(--warn))]">{L('Local and provider state disagree. An operator must reconcile before this asset can be used or deleted cleanly.', '로컬과 프로바이더 상태가 다릅니다. 운영자의 조정이 필요합니다.')}</p>}

              <dl className="mono grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11.5px]">
                {[
                  ['provider', a.providerId], ['provider id', a.providerAvatarId ?? '—'], ['mode', a.creationMode],
                  ['source hash', a.sourceContentHash.slice(0, 16)], ['deletion', a.deletionStatus],
                  ['created', fmtTime(a.createdAt)], ['updated', fmtTime(a.updatedAt)], ['expires', fmtTime(a.expiresAt)],
                ].map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd></Fragment>))}
              </dl>

              <div>
                <div className="eyebrow mb-2">{L('Capabilities', '기능')}</div>
                <ul className="divide-y rounded border">
                  {caps.map(([k, v]) => <li key={k} className="flex items-center justify-between px-3 py-2 text-sm"><span>{k}</span><Pill value={v === 'yes' || v === 'supported' || v === 'live_verified' ? 'available' : v === 'no' || v === 'unsupported' ? 'ended' : 'pending'} label={v.replace('_', ' ')} /></li>)}
                </ul>
              </div>

              {a.status === 'ready' && (
                <div className="space-y-2 rounded border border-[hsl(var(--warn)/.35)] bg-[hsl(var(--warn)/.06)] p-3 text-[12.5px]">
                  <p>{L('Ready means the provider returned a reusable avatar ID. A live session against this asset has not been verified, so live runtime remains unavailable and no preview video exists.', 'Ready는 프로바이더가 재사용 가능한 ID를 반환했다는 뜻입니다. 라이브 세션은 검증되지 않아 라이브 런타임은 사용할 수 없고 미리보기 영상도 없습니다.')}</p>
                  <button data-testid="button-use-in-playground"
                    onClick={() => { setSelectedAsset({ id: a.id, name: a.name, providerId: a.providerId, providerAvatarId: a.providerAvatarId, imageAssetId: a.imageAssetId }); setLocation('/playground'); }}
                    className="inline-flex items-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition active:scale-[.97]">
                    <FlaskConical className="h-3.5 w-3.5" /> {L('Select in Playground', '플레이그라운드에서 선택')} <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              )}

              <button data-testid="button-delete-avatar" disabled={a.status === 'deleting' || a.status === 'deleted' || del.isPending} onClick={() => setConfirm(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded border border-destructive/40 py-2 text-sm text-destructive transition hover:bg-destructive/5 disabled:opacity-40">
                <Trash2 className="h-4 w-4" /> {a.status === 'deleting' ? L('Deleting at provider…', '프로바이더에서 삭제 중…') : L('Delete avatar', '아바타 삭제')}
              </button>
            </div>
          ) : null}
        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{L('Delete this avatar at the provider?', '프로바이더에서 이 아바타를 삭제할까요?')}</AlertDialogTitle>
              <AlertDialogDescription>
                {L('This is irreversible. The provider avatar ID is destroyed and any training spend is not recoverable. Recreating it means a new request and possibly new charges.', '되돌릴 수 없습니다. 프로바이더 아바타 ID가 삭제되며 학습 비용은 회수되지 않습니다. 다시 만들려면 새 요청과 추가 비용이 필요할 수 있습니다.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-avatar">{L('Keep it', '유지')}</AlertDialogCancel>
              <AlertDialogAction data-testid="button-confirm-delete-avatar" className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => del.mutate({ id }, {
                  onSuccess: () => {
                    qc.invalidateQueries({ queryKey: getListAvatarAssetsQueryKey() });
                    qc.invalidateQueries({ queryKey: getGetAvatarAssetQueryKey(id) });
                    if (selected?.id === id) setSelectedAsset(null);
                    toast({ title: L('Deletion requested', '삭제 요청됨') });
                  },
                  onError: (e) => toast({ title: L('Delete failed', '삭제 실패'), description: errMsg(e), variant: 'destructive' }),
                })}>
                {L('Delete irreversibly', '영구 삭제')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- capability discovery ---------------- */

function CapabilityPanel() {
  const L = useL();
  const q = useListProvisioningProviders({ query: { queryKey: getListProvisioningProvidersQueryKey(), staleTime: 60000 } });
  const flags: [keyof ProvisioningProvider, string][] = [
    ['imageCreation', L('Image → avatar', '이미지 → 아바타')], ['customTraining', L('Training', '학습')],
    ['reusableId', L('Reusable ID', '재사용 ID')], ['realtimeRendering', L('Realtime', '실시간')],
  ];
  return (
    <Panel title={L('Provisioning capabilities', '프로비저닝 기능')} aside={<span className="mono text-[10.5px] text-muted-foreground">{L('public', '공개')}</span>}>
      {q.isLoading ? <div className="p-4"><Skel className="h-40" /></div>
        : q.isError ? <div className="p-4"><ErrorState onRetry={() => q.refetch()} /></div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="mono border-b text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">{L('Provider', '프로바이더')}</th>
                {flags.map(([, l]) => <th key={l} className="px-2 py-2 font-medium">{l}</th>)}
                <th className="px-2 py-2 font-medium">{L('Emotion', '감정')}</th>
                <th className="px-2 py-2 font-medium">{L('Adapter', '어댑터')}</th>
                <th className="px-4 py-2 font-medium">{L('Requirements', '요구 사항')}</th>
              </tr></thead>
              <tbody className="divide-y">
                {q.data?.map((p) => (
                  <tr key={p.id} data-testid={`row-capability-${p.id}`} className={cn(!p.adapterEnabled && 'text-muted-foreground')}>
                    <td className="px-4 py-3 font-semibold">{p.name}</td>
                    {flags.map(([k]) => <td key={k} className="mono px-2 py-3 text-xs">{p[k] ? L('yes', '예') : '—'}</td>)}
                    <td className="mono px-2 py-3 text-xs">{p.emotionControl}</td>
                    <td className="px-2 py-3">
                      <Pill value={!p.adapterEnabled ? 'ended' : p.configured ? 'available' : 'unconfigured'} label={!p.adapterEnabled ? L('documented', '문서만') : p.configured ? L('enabled', '활성') : L('unconfigured', '미설정')} />
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs">
                      {p.requirements}{' '}
                      <a href={p.documentationUrl} target="_blank" rel="noreferrer" data-testid={`link-docs-${p.id}`} className="inline-flex items-center gap-0.5 text-primary hover:underline">docs <ExternalLink className="h-3 w-3" /></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  );
}
