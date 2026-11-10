import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, AnamEvent, type AnamClient } from '@anam-ai/js-sdk';
import { LogIn, MessagesSquare, Mic, Play, Radio, Square } from 'lucide-react';
import {
  useCreateSession, useGetSession, useGetLiveLimits, useListAvatars, useListSessions,
  getSession, createAnamConnection, endSession, listSessions,
  getGetSessionQueryKey, getGetLiveLimitsQueryKey, getListSessionsQueryKey, getGetUsageQueryKey, getListSessionEventsQueryKey,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { Panel, Pill, errMsg } from '@/components/bits';
import { cn } from '@/lib/utils';
import { AnamRoleplayFields } from '@/components/anam-roleplay-fields';
import { emptyRoleplayDraft, prepareRoleplay } from '@/lib/anam-roleplay-input';
import { accountIsCurrent, anamRecoverySessions, needsAnamRecovery, loadAnamRecovery, endLateAnamCreation } from '@/lib/anam-session-recovery';

const PERSONA_ID = 'anam-persona-default';
const VIDEO_ID = 'anam-live-video';
const POLL_MS = 2000;
const QUEUE_TIMEOUT_MS = 90_000;
const STOP_DEADLINE_S = 120;

type Phase = 'idle' | 'creating' | 'queued' | 'token' | 'connecting' | 'connected' | 'playing' | 'stopping' | 'ended' | 'error' | 'recovered';

function useL() {
  const { lang } = useI18n();
  return (en: string, ko: string) => (lang === 'en' ? en : ko);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AnamLivePanel() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const uid = isSignedIn ? userId ?? null : null;
  const account = useRef(uid);
  account.current = uid;
  if (!isLoaded) return null;
  // Account changes unmount the old view before any old metadata can be shown.
  return <AnamLiveSession key={uid ?? 'signed-out'} uid={uid} account={account} />;
}

function AnamLiveSession({ uid, account }: { uid: string | null; account: { current: string | null } }) {
  const L = useL();
  const qc = useQueryClient();

  const limitsParams = { providerId: 'anam' as const };
  const limits = useGetLiveLimits(limitsParams, {
    query: { queryKey: [...getGetLiveLimitsQueryKey(limitsParams), uid], enabled: !!uid, refetchInterval: 5000, staleTime: 0 },
  });
  const avatars = useListAvatars();
  const persona = avatars.data?.find((a) => a.id === PERSONA_ID);

  const [sid, setSid] = useState('');
  const [recovered, setRecovered] = useState(false);
  const recoveredRef = useRef(false);
  recoveredRef.current = recovered;
  const [phase, setPhase] = useState<Phase>('idle');
  const [ack, setAck] = useState(false);
  const [roleplayEnabled, setRoleplayEnabled] = useState(false);
  const [roleplayDraft, setRoleplayDraft] = useState(emptyRoleplayDraft);
  const preparedRoleplay = prepareRoleplay(roleplayEnabled, roleplayDraft);
  const [err, setErr] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [tokenExp, setTokenExp] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const clientRef = useRef<AnamClient | null>(null);
  const runRef = useRef(0);
  const sidRef = useRef(''); sidRef.current = sid;
  const mounted = useRef(false);
  const isCurrent = useCallback(() => accountIsCurrent(uid, account.current, mounted.current), [uid, account]);
  const sessionKey = (id: string) => [...getGetSessionQueryKey(id), uid];
  const owned = useListSessions({
    query: {
      queryKey: [...getListSessionsQueryKey(), uid], enabled: !!uid, gcTime: 0,
      staleTime: 0, refetchOnMount: 'always', refetchInterval: POLL_MS, retry: false,
      queryFn: ({ signal }) => loadAnamRecovery(() => listSessions({ signal }), () => account.current === uid && !!uid),
    },
  });
  const recoverable = anamRecoverySessions(owned.data ?? []);

  const session = useGetSession(sid, {
    query: {
      queryKey: sessionKey(sid),
      enabled: !!sid && !!uid,
      gcTime: 0, staleTime: 0, retry: false,
      refetchInterval: (q) => (!q.state.data || needsAnamRecovery(q.state.data) ? POLL_MS : false),
    },
  });
  const s = session.data;
  const create = useCreateSession({ mutation: { gcTime: 0 } });
  const startingRef = useRef(false);

  const invalidate = useCallback((id: string) => {
    qc.invalidateQueries({ queryKey: getGetSessionQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionEventsQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUsageQueryKey() });
  }, [qc]);

  /* SDK teardown: never throws, never logs raw SDK detail */
  const stopClient = useCallback(async () => {
    const c = clientRef.current;
    clientRef.current = null;
    if (c) {
      try { await Promise.race([c.stopStreaming(), sleep(3000)]); } catch { /* router end must still run */ }
    }
  }, []);

  /* Stop: SDK stop + router end, even after connection errors */
  const stop = useCallback(async (reason?: string) => {
    runRef.current++;
    const id = sidRef.current;
    setPhase('stopping');
    const sdkStop = stopClient();
    if (id) {
      try { if (isCurrent()) await endSession(id); } catch (e) { if (isCurrent()) setErr(errMsg(e)); }
      invalidate(id);
    }
    await sdkStop;
    if (isCurrent()) {
      setPhase(id ? 'ended' : 'idle');
      setDeadline(null); setTokenExp(null);
      if (reason) setErr(reason);
    }
  }, [stopClient, invalidate, isCurrent]);
  const stopRef = useRef(stop); stopRef.current = stop;

  const startAttempt = async () => {
    if (!ack || !uid || phase !== 'idle' && phase !== 'ended' && phase !== 'error') return;
    const context = prepareRoleplay(roleplayEnabled, roleplayDraft);
    if (context.invalid) return;
    const run = ++runRef.current;
    const live = () => isCurrent() && runRef.current === run;
    setErr(null); setAck(false); setDeadline(null); setTokenExp(null);
    setPhase('creating');

    let id = '';
    try {
      // A fresh free lookup closes the gap between list polling and a paid start.
      const check = await owned.refetch();
      if (!live()) return;
      if (check.error || !check.data) throw new Error(L('Could not confirm existing sessions. Refresh status before starting.', '기존 세션을 확인하지 못했습니다. 상태를 다시 확인한 뒤 시작하세요.'));
      if (anamRecoverySessions(check.data).length) { setPhase('idle'); return; }
      setRecovered(false); recoveredRef.current = false;
      const ns = await create.mutateAsync({ data: {
        providerId: 'anam', avatarId: PERSONA_ID, pipeline: 'anam_full', mode: 'live', costConfirmed: true,
        ...context,
      } });
      id = ns.id;
    } catch (e) {
      if (live()) { setErr(errMsg(e)); setPhase('error'); }
      qc.invalidateQueries({ queryKey: getGetUsageQueryKey() });
      return;
    } finally {
      create.reset(); // Do not retain submitted context in the mutation observer.
    }
    if (!live()) {
      // Closing this view may finish creation later; never end it as a new user.
      void endLateAnamCreation(id, uid, () => account.current, endSession);
      return;
    }
    setSid(id); sidRef.current = id; invalidate(id);
    setPhase('queued');

    /* poll until worker reports active + running */
    const t0 = Date.now();
    for (;;) {
      await sleep(POLL_MS);
      if (!live()) return;
      let cur;
      try { cur = await getSession(id); } catch (e) {
        if (live()) setErr(errMsg(e));
        if (Date.now() - t0 > QUEUE_TIMEOUT_MS) { void stopRef.current(L('Session status timed out; stop requested.', '상태 조회 시간이 초과되어 종료를 요청했습니다.')); return; }
        continue;
      }
      if (!live()) return;
      qc.setQueryData(sessionKey(id), cur);
      if (cur.status !== 'active') { setPhase('ended'); setErr(cur.error ?? L('Session ended before it became ready.', '준비 전에 세션이 종료되었습니다.')); return; }
      if (cur.stopRequested) { setPhase('ended'); return; }
      if (cur.rendererState === 'running') break;
      if (Date.now() - t0 > QUEUE_TIMEOUT_MS) { void stopRef.current(L('Worker did not become ready in time. Session stopped; no retry.', '워커 준비 시간이 초과되어 세션을 종료했습니다. 재시도하지 않습니다.')); return; }
    }

    /* single connection request, no retry */
    setPhase('token');
    let token: string;
    try {
      const c = await createAnamConnection(id);
      token = c.sessionToken;
      if (!live()) return;
      setDeadline(new Date(c.expiresAt).getTime());
      setTokenExp(c.tokenExpiresAt);
    } catch (e) {
      if (live()) void stopRef.current(errMsg(e));
      return;
    }

    setPhase('connecting');
    try {
      const client = createClient(token, { api: { retry: { maxAttempts: 1 } } });
      token = '';
      clientRef.current = client;
      client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => { if (live()) setPhase((p) => (p === 'playing' ? p : 'connected')); });
      client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => { if (live()) setPhase('playing'); });
      client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        if (live() && clientRef.current === client) void stopRef.current(L('Avatar connection closed.', '아바타 연결이 종료되었습니다.'));
      });
      await client.streamToVideoElement(VIDEO_ID);
      if (!live()) { try { await client.stopStreaming(); } catch { /* ignore */ } }
    } catch {
      if (live()) void stopRef.current(L('Could not start the avatar stream (microphone permission or network). Session stopped; no retry.', '아바타 스트림을 시작하지 못했습니다(마이크 권한 또는 네트워크). 세션을 종료했고 재시도하지 않습니다.'));
    }
  };
  const start = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    try { await startAttempt(); } finally { startingRef.current = false; }
  };

  /* Discover metadata only. This path must never request connection credentials. */
  useEffect(() => {
    if (!uid || account.current !== uid || !owned.data || startingRef.current || clientRef.current ||
      ['creating', 'queued', 'token', 'connecting', 'connected', 'playing', 'stopping'].includes(phase)) return;
    const candidate = recoverable.find(row => row.id === sid) ?? recoverable[0];
    if (!candidate || candidate.id === sid) return;
    runRef.current++;
    setRecovered(true); recoveredRef.current = true;
    setSid(candidate.id); sidRef.current = candidate.id;
    qc.setQueryData(sessionKey(candidate.id), candidate);
    setDeadline(null); setTokenExp(null); setAck(false); setErr(null);
    setPhase('recovered');
  }, [owned.data, sid, phase, isCurrent, qc, uid]);

  useEffect(() => {
    if (recovered && s && !needsAnamRecovery(s)) setPhase('ended');
  }, [recovered, s]);

  /* router deadline timer */
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  const remaining = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  useEffect(() => {
    if (remaining === 0 && (phase === 'connecting' || phase === 'connected' || phase === 'playing' || phase === 'token')) {
      void stopRef.current(L('Router stop deadline reached.', '라우터 종료 기한에 도달했습니다.'));
    }
  }, [remaining, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* server ended it */
  useEffect(() => {
    if (s && s.status !== 'active' && clientRef.current) {
      runRef.current++;
      setPhase('ended');
      setDeadline(null);
      setTokenExp(null);
      void stopClient();
    }
  }, [s?.status, s, stopClient]);

  /* unmount / nav: cancel pending run, stop SDK + router (deferred for StrictMode) */
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = sidRef.current;
      const wasRecovered = recoveredRef.current;
      setTimeout(() => {
        if (mounted.current) return;
        runRef.current++;
        const c = clientRef.current; clientRef.current = null;
        if (c) void c.stopStreaming().catch(() => {});
        if (id && !wasRecovered && account.current === uid) void endSession(id).catch(() => {});
      }, 0);
    };
  }, []);

  /* pagehide keepalive end */
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted || !sidRef.current || recoveredRef.current || !isCurrent()) return;
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      try { void fetch(`${base}/api/v1/sessions/${sidRef.current}/end`, { method: 'POST', keepalive: true, credentials: 'include' }); } catch { /* TTL bounds */ }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const busy = ['creating', 'queued', 'token', 'connecting', 'connected', 'playing'].includes(phase);
  const recoveredPending = recovered && (!s || needsAnamRecovery(s));
  const cleanupPending = !!s?.cleanupPending || (limits.data?.cleanupPending ?? 0) > 0;
  const lim = limits.data;
  const canStart = ack && !busy && phase !== 'stopping' && !create.isPending && !!lim?.workerReady && lim.creationAllowed !== false
    && lim.userRemainingSeconds >= STOP_DEADLINE_S && lim.globalRemainingSeconds >= STOP_DEADLINE_S && !cleanupPending && !preparedRoleplay.invalid
    && owned.isSuccess && !owned.isError && !session.isError && !recoverable.length && !recoveredPending;

  const steps: { k: string; on: boolean; label: string }[] = [
    { k: 'queued', on: ['queued', 'token', 'connecting', 'connected', 'playing'].includes(phase), label: L('worker', '워커') },
    { k: 'token', on: ['connecting', 'connected', 'playing'].includes(phase), label: L('token ready', '토큰 준비') },
    { k: 'conn', on: ['connected', 'playing'].includes(phase), label: L('connected', '연결됨') },
    { k: 'video', on: phase === 'playing', label: L('video playing', '영상 재생') },
  ];

  return (
    <div id="anam" className="rise mb-8">
      <Panel
        title={<span className="flex items-center gap-2"><Radio className="h-3.5 w-3.5 text-primary" />{L('Native Anam live · anam_full', 'Anam 네이티브 라이브 · anam_full')}</span>}
        aside={<span className="mono text-[10.5px] text-muted-foreground">{L('Anam owns voice + dialogue', 'Anam이 음성·대화 담당')}</span>}
      >
        {!uid ? (
          <div className="flex flex-wrap items-center justify-between gap-4 p-5" data-testid="anam-signed-out">
            <p className="max-w-lg text-sm text-muted-foreground">{L('Native Anam sessions consume paid provider credits, so they require sign-in.', 'Anam 네이티브 세션은 유료 공급자 크레딧을 사용하므로 로그인이 필요합니다.')}</p>
            <Link href="/sign-in" data-testid="link-anam-sign-in" className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97]">
              <LogIn className="h-4 w-4" /> {L('Sign in', '로그인')}
            </Link>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="relative aspect-video bg-sidebar text-sidebar-foreground">
              <video id={VIDEO_ID} autoPlay playsInline data-testid="video-anam"
                className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', phase === 'playing' ? 'opacity-100' : 'opacity-0')} />
              {phase !== 'playing' && (
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <div className="mono text-[10.5px] uppercase tracking-widest opacity-60" data-testid="status-anam-phase">{phase}</div>
                    <p className="mt-2 max-w-xs text-xs opacity-50">{L('Shown only after the SDK reports the first video playing. A token or connection alone is not playback.', 'SDK가 첫 영상 재생을 알린 뒤에만 표시됩니다. 토큰이나 연결만으로는 재생이 아닙니다.')}</p>
                  </div>
                </div>
              )}
              <div className="mono absolute left-3 top-3 flex flex-wrap gap-1.5 text-[10px]">
                {steps.filter((st) => st.on).map((st) => (
                  <span key={st.k} className={cn('rounded-sm px-1.5 py-0.5', st.on ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent')}>{st.label}</span>
                ))}
              </div>
              {remaining !== null && (
                <span className="mono absolute right-3 top-3 rounded-sm bg-sidebar-accent px-1.5 py-0.5 text-[10px]" data-testid="text-anam-remaining">{remaining}s</span>
              )}
            </div>

            <div className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="break-all text-lg font-bold" data-testid="text-anam-persona">{persona?.name ?? (avatars.isLoading ? '…' : L('Configured Anam persona', '설정된 Anam 페르소나'))}</div>
                  <div className="mono break-all text-[10.5px] text-muted-foreground">anam · {persona?.id ?? PERSONA_ID}{persona && !persona.configured ? ` · ${L('not configured', '미설정')}` : ''}</div>
                </div>
                {s ? <Pill value={s.status} live={s.status === 'active'} /> : <Pill value="ended" label={L('idle', '대기')} />}
              </div>

              {owned.isPending && <p className="text-xs text-muted-foreground" role="status">{L('Checking your existing Anam sessions…', '기존 Anam 세션을 확인하고 있습니다…')}</p>}
              {(owned.isError || session.isError) && (
                <div className="rounded border border-destructive/40 p-3 text-xs" role="alert" data-testid="anam-recovery-error">
                  <p>{L('Session status could not be confirmed. New starts remain blocked until the check succeeds.', '세션 상태를 확인하지 못했습니다. 확인이 성공할 때까지 새 시작을 차단합니다.')}</p>
                  <button type="button" onClick={() => { void owned.refetch(); if (sid) void session.refetch(); }}
                    className="mt-2 rounded border px-2 py-1 hover:bg-muted" data-testid="button-anam-recovery-retry">
                    {L('Refresh status', '상태 다시 확인')}
                  </button>
                </div>
              )}
              {recovered && (
                <div className="space-y-2 rounded border border-primary/40 bg-primary/5 p-3 text-xs" data-testid="anam-recovered-session">
                  <p className="font-semibold">{L('Previous Anam session found', '이전 Anam 세션을 찾았습니다')}</p>
                  <p>{L('Status and stop controls were restored from your server records. Video, microphone and connection tokens are not restarted or reissued. Leaving this restored view does not stop a session in another tab.',
                    '서버 기록에서 상태와 종료 기능을 복구했습니다. 영상·마이크를 다시 시작하거나 연결 토큰을 재발급하지 않습니다. 이 복구 화면을 벗어나는 것만으로 다른 탭의 대화를 종료하지 않습니다.')}</p>
                  <p className="mono break-all" data-testid="anam-recovered-id">{sid}</p>
                  <p data-testid="anam-recovered-state">{L('Server state', '서버 상태')}: {s?.status ?? '…'} · {s?.rendererState ?? '…'}{s?.stopRequested ? ` · ${L('stop requested', '종료 요청됨')}` : ''}</p>
                  {s?.error && <p className="mono break-all text-destructive">{s.error}</p>}
                  {s && <p>{L('Server expiry', '서버 만료 시각')}: {new Date(s.expiresAt).toLocaleString()}</p>}
                  {recoverable.length > 1 && (
                    <label className="block space-y-1">
                      <span>{L('Other sessions awaiting resolution', '확인이 필요한 다른 세션')}</span>
                      <select value={sid} disabled={phase === 'stopping'} data-testid="select-anam-recovery"
                        className="w-full rounded border bg-background p-1.5"
                        onChange={e => {
                          const row = recoverable.find(item => item.id === e.target.value);
                          if (!row) return;
                          setSid(row.id); sidRef.current = row.id;
                          qc.setQueryData(sessionKey(row.id), row);
                          setPhase('recovered'); setErr(null);
                        }}>
                        {recoverable.map(row => <option key={row.id} value={row.id}>{row.id} · {row.rendererState ?? row.status}</option>)}
                      </select>
                    </label>
                  )}
                  <button type="button" onClick={() => { void owned.refetch(); void session.refetch(); }}
                    className="rounded border px-2 py-1 hover:bg-muted" data-testid="button-anam-recovery-refresh">
                    {L('Refresh status', '상태 다시 확인')}
                  </button>
                </div>
              )}

              <div className="rounded border p-3 text-xs text-muted-foreground" data-testid="text-anam-bounds">
                <p>{L(`Router stop deadline: ${STOP_DEADLINE_S}s per attempt, enforced server-side.`, `라우터 종료 기한: 시도당 ${STOP_DEADLINE_S}초, 서버에서 강제.`)}{remaining !== null ? L(` ${remaining}s left.`, ` 남은 시간 ${remaining}초.`) : ''}</p>
                {tokenExp && <p className="mt-1">{L('Start-token expiry', '시작 토큰 만료')}: <span className="mono">{new Date(tokenExp).toLocaleTimeString()}</span> {L('(not call duration)', '(통화 시간 아님)')}</p>}
                {lim && <p className="mt-1">{L('Daily budget', '일일 예산')}: {L('You', '사용자')} {lim.userRemainingSeconds}s / {lim.userDailySeconds}s · {L('Service', '전체')} {lim.globalRemainingSeconds}s / {lim.globalDailySeconds}s</p>}
                {lim && !lim.workerReady && <p className="mt-1 text-destructive">{L('Worker unavailable. Paid starts are blocked.', '워커가 응답하지 않아 유료 시작을 차단했습니다.')}</p>}
              </div>

              {(cleanupPending || phase === 'stopping') && (
                <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="warning-anam-cleanup">
                  {L('Stop requested. Waiting for confirmed provider cleanup; new paid sessions stay blocked until then.', '종료를 요청했습니다. 공급자 정리 확인을 기다리며, 그때까지 새 유료 세션은 차단됩니다.')}
                </div>
              )}

              <div className="flex items-start gap-2 rounded border p-3 text-[12px] text-muted-foreground">
                <MessagesSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{L('Anam runs the voice and dialogue end to end. Gemini input/audio is not used at the same time. Your microphone is requested by the browser when streaming starts; camera is never requested.', 'Anam이 음성과 대화를 직접 처리합니다. Gemini 입력/오디오는 동시에 사용하지 않습니다. 스트리밍 시작 시 브라우저가 마이크 권한을 요청하며 카메라는 요청하지 않습니다.')}</span>
              </div>

              <AnamRoleplayFields enabled={roleplayEnabled} draft={roleplayDraft}
                onEnabled={setRoleplayEnabled} onDraft={setRoleplayDraft} L={L} />
              {preparedRoleplay.invalid && (
                <p role="status" className="text-xs text-destructive" data-testid="anam-roleplay-validation">
                  {L('Complete the required roleplay fields and check their length before starting.',
                    '시작 전에 필수 역할 입력과 글자 수 제한을 확인하세요.')}
                </p>
              )}

              {!busy && !recoveredPending && phase !== 'stopping' && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded border border-primary/40 bg-primary/5 p-3 text-[12.5px]">
                  <input type="checkbox" data-testid="checkbox-anam-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span>{L('This may consume Anam credits. One session, one connection attempt, no automatic retry or reconnect. It is stopped at the router deadline.', 'Anam 크레딧이 사용될 수 있습니다. 세션 1개, 연결 시도 1회이며 자동 재시도·재연결은 없습니다. 라우터 기한에 종료됩니다.')}</span>
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                {!busy && !recoveredPending && phase !== 'stopping' ? (
                  <button data-testid="button-anam-start" disabled={!canStart} onClick={() => void start()}
                    className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97] disabled:opacity-40">
                    <Play className="h-4 w-4" /> {L('Start Anam live', 'Anam 라이브 시작')}
                  </button>
                ) : (
                  <button data-testid="button-anam-stop" disabled={phase === 'stopping'} onClick={() => void stop()}
                    className="inline-flex items-center gap-2 rounded border border-destructive/40 px-4 py-2 text-sm text-destructive transition hover:bg-destructive/5 active:scale-[.97] disabled:opacity-40">
                    <Square className="h-4 w-4" /> {phase === 'stopping' ? L('Stopping…', '종료 중…') : L('Stop', '종료')}
                  </button>
                )}
                {phase === 'playing' && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Mic className="h-3.5 w-3.5 text-primary" />{L('Speak to the avatar', '아바타에게 말하세요')}</span>}
              </div>

              {err && (
                <div className="rounded border border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/5 p-3" data-testid="text-anam-error">
                  <div className="mono text-[11px] uppercase tracking-wider text-[hsl(var(--warn))]">{L('status', '상태')}</div>
                  <p className="mt-1 text-sm">{err}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
