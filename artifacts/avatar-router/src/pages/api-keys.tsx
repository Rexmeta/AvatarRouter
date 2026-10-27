import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react';
import {
  getListDeveloperKeysQueryKey, useCreateDeveloperKey, useListDeveloperKeys, useRevokeDeveloperKey, useRotateDeveloperKey,
  type DeveloperKey,
} from '@workspace/api-client-react';
import { CopyBlock, ErrorState, PageHead, Panel, Pill, Skel, errMsg, fmtTime } from '@/components/bits';
import { ConnectionSetup, DEFAULT_SCOPES, KeyFacts, SCOPES } from '@/components/api-key-setup';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Issued = { key: DeveloperKey; secret: string; rotated: boolean };
type Pending = { kind: 'rotate' | 'revoke'; key: DeveloperKey } | null;

function keyState(k: DeveloperKey): 'active' | 'revoked' | 'expired' {
  if (k.revokedAt) return 'revoked';
  if (new Date(k.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

export default function ApiKeys() {
  const { lang, t } = useI18n();
  const en = lang === 'en';
  const { isLoaded, isSignedIn, userId } = useAuth();
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const qc = useQueryClient();
  const list = useListDeveloperKeys({ query: { enabled: isLoaded && !!isSignedIn, queryKey: getListDeveloperKeysQueryKey(), refetchInterval: 30000 } });
  const create = useCreateDeveloperKey({ mutation: { gcTime: 0 } });
  const rotate = useRotateDeveloperKey({ mutation: { gcTime: 0 } });
  const revoke = useRevokeDeveloperKey();

  const [issued, setIssued] = useState<Issued | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [days, setDays] = useState('90');

  // Clear one-time secret on sign-out or user switch.
  useEffect(() => { setIssued(null); setPending(null); }, [userId, isSignedIn]);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListDeveloperKeysQueryKey() });
  const daysNum = Number(days);
  const daysOk = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365;
  const canCreate = name.trim().length >= 1 && name.trim().length <= 60 && scopes.length > 0 && daysOk && !create.isPending;

  const onCreate = async () => {
    const initiatingUser = userId;
    setActionError(null);
    try {
      const r = await create.mutateAsync({ data: { projectName: name.trim(), scopes, expiresInDays: daysNum } });
      if (currentUser.current !== initiatingUser) return;
      setIssued({ key: r.key, secret: r.secret, rotated: false });
      setName('');
    } catch (e) { setActionError(errMsg(e)); }
    finally { create.reset(); invalidate(); }
  };

  const onConfirm = async () => {
    const initiatingUser = userId;
    if (!pending) return;
    const { kind, key } = pending;
    setPending(null);
    setActionError(null);
    try {
      if (kind === 'rotate') {
        const r = await rotate.mutateAsync({ id: key.id });
        if (currentUser.current !== initiatingUser) return;
        setIssued({ key: r.key, secret: r.secret, rotated: true });
      } else {
        await revoke.mutateAsync({ id: key.id });
        if (issued?.key.id === key.id) setIssued(null);
      }
    } catch (e) { setActionError(errMsg(e)); }
    finally { rotate.reset(); invalidate(); }
  };

  const head = <PageHead index="06 / api keys" title={t('keys.title')} lede={en ? 'Server credentials for adding live avatars to your product. Keep your login and your dialogue; AvatarRouter only renders.' : '제품에 라이브 아바타를 추가하기 위한 서버 자격 증명. 로그인과 대화는 그대로 두고 AvatarRouter는 렌더링만 합니다.'} />;

  if (!isLoaded) return <div>{head}<Skel className="h-40 w-full" /></div>;
  if (!isSignedIn) {
    return (
      <div>
        {head}
        <Panel className="p-6">
          <KeyRound className="mb-3 h-6 w-6 text-primary" />
          <p className="mb-4 max-w-md text-sm text-muted-foreground">{en ? 'Sign in to create and manage project API keys.' : '프로젝트 API 키를 만들고 관리하려면 로그인하세요.'}</p>
          <Link href="/sign-in" data-testid="link-keys-sign-in" className="inline-flex rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{en ? 'Sign in' : '로그인'}</Link>
        </Panel>
      </div>
    );
  }

  const keys = list.data ?? [];
  const busy = rotate.isPending || revoke.isPending;

  return (
    <div>
      {head}

      {issued && (
        <section className="rise mb-8 rounded-md border-2 border-primary bg-card p-5 shadow-md" data-testid="panel-issued-secret">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow text-primary">{issued.rotated ? (en ? 'rotated — old secret is now invalid' : '교체됨 — 이전 시크릿은 즉시 무효') : (en ? 'new project key' : '새 프로젝트 키')}</div>
              <h2 className="break-all text-lg font-bold">{issued.key.projectName}</h2>
              <p className="text-sm text-muted-foreground">{en ? 'This secret is shown once. It is not stored in this browser and cannot be retrieved again.' : '이 시크릿은 한 번만 표시됩니다. 브라우저에 저장되지 않으며 다시 조회할 수 없습니다.'}</p>
            </div>
            <button data-testid="button-dismiss-secret" onClick={() => setIssued(null)} className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs hover:bg-muted"><X className="h-3 w-3" />{en ? "I've saved it" : '저장했습니다'}</button>
          </div>
          <CopyBlock label="secret" code={issued.secret} />
          <div className="mt-4"><ConnectionSetup secret={issued.secret} /></div>
        </section>
      )}

      {actionError && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="text-action-error">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="dismiss" data-testid="button-dismiss-error"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <Panel title={en ? 'Create project key' : '프로젝트 키 생성'}>
            <div className="space-y-4 p-4">
              <p className="text-[13px] text-muted-foreground">{en ? 'Each new key creates a separate project. Rotating keeps the project and its sessions.' : '새 키마다 별도 프로젝트가 생성됩니다. 교체 시 프로젝트는 유지됩니다.'}</p>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <label className="text-sm">
                  <span className="eyebrow mb-1 block">{en ? 'Project name' : '프로젝트 이름'}</span>
                  <input data-testid="input-project-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={en ? 'e.g. tutoring-prod' : '예: tutoring-prod'} className="w-full rounded border border-input bg-background px-3 py-2 outline-none focus:border-primary" />
                </label>
                <label className="text-sm">
                  <span className="eyebrow mb-1 block">{en ? 'Expires (days)' : '만료(일)'}</span>
                  <input data-testid="input-expires-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={cn('w-full rounded border bg-background px-3 py-2 outline-none focus:border-primary', daysOk ? 'border-input' : 'border-destructive')} />
                </label>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="eyebrow">{en ? 'Scopes' : '스코프'} · {scopes.length}/9</span>
                  <span className="flex gap-2 text-[11px]">
                    <button data-testid="button-scopes-default" onClick={() => setScopes(DEFAULT_SCOPES)} className="underline-offset-2 hover:underline">{en ? 'defaults' : '기본값'}</button>
                    <button data-testid="button-scopes-none" onClick={() => setScopes([])} className="underline-offset-2 hover:underline">{en ? 'clear' : '비우기'}</button>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SCOPES.map((s) => {
                    const on = scopes.includes(s);
                    return (
                      <button key={s} data-testid={`toggle-scope-${s}`} onClick={() => setScopes(on ? scopes.filter((x) => x !== s) : [...scopes, s])}
                        className={cn('mono rounded-sm border px-2 py-1 text-[11.5px] transition', on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted')}>
                        {s}
                      </button>
                    );
                  })}
                </div>
                {scopes.length === 0 && <p className="mt-2 text-xs text-destructive">{en ? 'Select at least one scope.' : '스코프를 하나 이상 선택하세요.'}</p>}
              </div>
              <button data-testid="button-create-key" disabled={!canCreate} onClick={onCreate} className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:opacity-40">
                <Plus className="h-4 w-4" />{create.isPending ? (en ? 'Creating…' : '생성 중…') : (en ? 'Create key' : '키 생성')}
              </button>
            </div>
          </Panel>

          <Panel title={en ? 'Keys' : '키 목록'} aside={list.isFetching ? <span className="mono text-[10px] opacity-50">sync…</span> : null}>
            {list.isLoading ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skel key={i} className="h-14 w-full" />)}</div>
            ) : list.isError ? (
              <div className="p-4"><ErrorState onRetry={() => list.refetch()} message={errMsg(list.error)} /></div>
            ) : keys.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <KeyRound className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">{en ? 'No keys yet' : '아직 키가 없습니다'}</p>
                <p className="max-w-xs text-xs text-muted-foreground">{en ? 'Create one above, then run the free auth check from your server.' : '위에서 생성한 뒤 서버에서 무료 인증 확인을 실행하세요.'}</p>
              </div>
            ) : (
              <ul className="divide-y">
                {keys.map((k) => {
                  const st = keyState(k);
                  return (
                    <li key={k.id} data-testid={`row-key-${k.id}`} className={cn('flex flex-col gap-3 p-4 md:flex-row md:items-center', st !== 'active' && 'opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all font-semibold">{k.projectName}</span>
                          <Pill value={st === 'active' ? 'active' : st === 'expired' ? 'expired' : 'failed'} label={st} />
                        </div>
                        <div className="mono mt-1 text-[11.5px] text-muted-foreground">{k.prefix}… · project {k.projectId.slice(0, 8)}</div>
                        <div className="mono mt-1 flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
                          <span>{en ? 'created' : '생성'} {fmtTime(k.createdAt)}</span>
                          <span>{en ? 'expires' : '만료'} {fmtTime(k.expiresAt)}</span>
                          <span>{en ? 'last used' : '최근 사용'} {k.lastUsedAt ? fmtTime(k.lastUsedAt) : (en ? 'never' : '없음')}</span>
                          {k.revokedAt && <span>{en ? 'revoked' : '폐기'} {fmtTime(k.revokedAt)}</span>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">{k.scopes.map((s) => <span key={s} className="mono rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px]">{s}</span>)}</div>
                      </div>
                      {!k.revokedAt && (
                        <div className="flex shrink-0 gap-2">
                          <button data-testid={`button-rotate-${k.id}`} disabled={busy} onClick={() => setPending({ kind: 'rotate', key: k })} className="inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40"><RefreshCw className="h-3 w-3" />{en ? 'Rotate' : '교체'}</button>
                          <button data-testid={`button-revoke-${k.id}`} disabled={busy} onClick={() => setPending({ kind: 'revoke', key: k })} className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/5 disabled:opacity-40"><Trash2 className="h-3 w-3" />{en ? 'Revoke' : '폐기'}</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {!issued && (
            <section className="rise space-y-3">
              <h2 className="text-xl font-bold">{en ? 'Connect your server' : '서버 연결'}</h2>
              <ConnectionSetup />
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Panel title={en ? 'How keys work' : '키 동작 방식'}><KeyFacts /></Panel>
        </aside>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" />
              {pending?.kind === 'rotate' ? (en ? 'Rotate key?' : '키를 교체할까요?') : (en ? 'Revoke key?' : '키를 폐기할까요?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'rotate'
                ? (en ? `The current secret for ${pending.key.projectName} stops working immediately. The project and scopes are kept, with a fresh 90-day expiry. Update your server with the new secret.` : `${pending.key.projectName}의 현재 시크릿은 즉시 무효화됩니다. 프로젝트와 권한은 유지되며 만료일이 90일 후로 갱신됩니다. 서버에 새 시크릿을 반영하세요.`)
                : (en ? `Revoking ${pending?.key.projectName ?? ''} blocks new calls but does not prove running paid sessions are cleaned up. End live sessions first.` : `${pending?.key.projectName ?? ''} 폐기는 새 호출을 차단하지만 실행 중인 유료 세션 정리를 보장하지 않습니다. 먼저 라이브 세션을 종료하세요.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">{en ? 'Cancel' : '취소'}</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-action" onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {pending?.kind === 'rotate' ? (en ? 'Rotate now' : '지금 교체') : (en ? 'Revoke' : '폐기')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
