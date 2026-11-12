import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, type DialogueMessage } from '@/sdk/avatarrouter-client';
import { SessionTranscript } from './session-transcript';
import { CheckCircle2, LogIn, MessagesSquare, Mic, Play, Radio, Square } from 'lucide-react';
import {
  useCreateSession, useReportAvatarLiveValidation, getGetAvatarAssetQueryKey, getListAvatarAssetsQueryKey, type AvatarAsset,
  useGetSession, useGetLiveLimits, useListAvatars, useListSessions,
  getSession, createClientConnection, endSession, listSessions,
  getGetSessionQueryKey, getGetLiveLimitsQueryKey, getListSessionsQueryKey, getGetUsageQueryKey, getListSessionEventsQueryKey,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { Panel, Pill, errMsg } from '@/components/bits';
import { cn } from '@/lib/utils';
import { AnamRoleplayFields } from '@/components/anam-roleplay-fields';
import { emptyRoleplayDraft, prepareRoleplay } from '@/lib/anam-roleplay-input';
import { accountIsCurrent, anamRecoverySessions, needsAnamRecovery, loadAnamRecovery, endLateAnamCreation } from '@/lib/anam-session-recovery';
import { emptyEvidence, observe, canReport, type Evidence } from '@/lib/live-validation-evidence';
import { hasConfirmedAnamStop, requestAnamStop, confirmAnamStop, type AnamStopState } from '@/lib/anam-stop-state';

const POLL_MS = 2000;
const QUEUE_TIMEOUT_MS = 90_000;

type Phase = 'idle' | 'creating' | 'queued' | 'token' | 'connecting' | 'connected' | 'playing' | 'stopping' | 'stop_unconfirmed' | 'ended' | 'error' | 'recovered';

function useL() {
  const { lang } = useI18n();
  return (en: string, ko: string) => (lang === 'en' ? en : ko);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AnamLivePanel() {
  return <NativeLivePanel providerId="anam" />;
}

export function NativeLivePanel({ providerId, asset }: { providerId: 'anam' | 'tavus'; asset?: AvatarAsset }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const uid = isSignedIn ? userId ?? null : null;
  const account = useRef(uid);
  account.current = uid;
  if (!isLoaded) return null;
  // Only a ready Tavus custom asset with a provider avatar ID may be targeted.
  const target = providerId === 'tavus' && asset && asset.providerId === 'tavus' && asset.status === 'ready' && asset.providerAvatarId ? asset : undefined;
  if (asset && !target) return <p role="alert">Custom validation requires a ready Tavus asset with its current provider avatar ID.</p>;
  // Account changes unmount the old view before any old metadata can be shown.
  return <AnamLiveSession key={`${providerId}:${uid ?? 'signed-out'}:${target ? `${target.id}:${target.providerAvatarId}` : 'stock'}`} providerId={providerId} uid={uid} account={account} asset={target} />;
}

function AnamLiveSession({ uid, account, providerId, asset }: { uid: string | null; account: { current: string | null }; providerId: 'anam' | 'tavus'; asset?: AvatarAsset }) {
  const providerName = providerId === 'anam' ? 'Anam' : 'Tavus';
  const custom = providerId === 'tavus' && asset?.providerAvatarId ? asset : undefined;
  const PERSONA_ID = custom?.providerAvatarId ?? (providerId === 'anam' ? 'anam-persona-default' : 'tavus-stock-lucy');
  const VIDEO_ID = `${providerId}-${custom ? `asset-${custom.id}` : 'live'}-video`;
  const L = useL();
  const qc = useQueryClient();

  const limitsParams = providerId === 'tavus' ? { providerId, pipeline: 'tavus_full' as const } : { providerId };
  const limits = useGetLiveLimits(limitsParams, {
    query: { queryKey: [...getGetLiveLimitsQueryKey(limitsParams), uid], enabled: !!uid, refetchInterval: 5000, staleTime: 0 },
  });
  const avatars = useListAvatars();
  const STOP_DEADLINE_S = limits.data?.sessionSeconds ?? 120;
  const persona = avatars.data?.find((a) => a.id === PERSONA_ID);

  const [sid, setSid] = useState('');
  const [recovered, setRecovered] = useState(false);
  const recoveredRef = useRef(false);
  recoveredRef.current = recovered;
  const [phase, setPhase] = useState<Phase>('idle');
  const [stopState, setStopState] = useState<AnamStopState | null>(null);
  const stopInFlight = useRef(false);
  const [checkingStop, setCheckingStop] = useState(false);
  const [ack, setAck] = useState(false);
  const [roleplayEnabled, setRoleplayEnabled] = useState(true);
  const [roleplayDraft, setRoleplayDraft] = useState(emptyRoleplayDraft);
  const preparedRoleplay = prepareRoleplay(roleplayEnabled, roleplayDraft);
  const [err, setErr] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [tokenExp, setTokenExp] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [messages, setMessages] = useState<DialogueMessage[]>([]);

  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);
  const runRef = useRef(0);
  const sidRef = useRef(''); sidRef.current = sid;
  const mounted = useRef(false);
  const isCurrent = useCallback(() => accountIsCurrent(uid, account.current, mounted.current), [uid, account]);
  const sessionKey = (id: string) => [...getGetSessionQueryKey(id), uid];
  const owned = useListSessions({
    query: {
      queryKey: [...getListSessionsQueryKey(), uid, providerId], enabled: !!uid, gcTime: 0,
      staleTime: 0, refetchOnMount: 'always', refetchInterval: POLL_MS, retry: false,
      queryFn: ({ signal }) => loadAnamRecovery(() => listSessions({ signal }), () => account.current === uid && !!uid, providerId),
    },
  });
  const recoverable = anamRecoverySessions(owned.data ?? [], providerId);

  const session = useGetSession(sid, {
    query: {
      queryKey: sessionKey(sid),
      enabled: !!sid && !!uid,
      gcTime: 0, staleTime: 0, retry: false,
      refetchInterval: (q) => (!q.state.data || needsAnamRecovery(q.state.data, providerId) ? POLL_MS : false),
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

  /* Validation evidence (custom Tavus only). Never reported automatically. */
  const [evidence, setEvidence] = useState<Evidence>(emptyEvidence);
  const [heard, setHeard] = useState(false);
  const [reportState, setReportState] = useState<{ kind: 'ok' | 'fail'; msg?: string; sid: string } | null>(null);
  const reportInFlight = useRef(false);
  const reportedSid = useRef('');
  const report = useReportAvatarLiveValidation({ mutation: { gcTime: 0 } });
  const resetEvidence = useCallback(() => { setEvidence(emptyEvidence()); setHeard(false); setReportState(null); }, []);
  useEffect(() => { resetEvidence(); }, [sid, resetEvidence]);
  /* SDK teardown: never throws, never logs raw SDK detail */
  const stopClient = useCallback(async () => {
    const c = clientRef.current;
    clientRef.current = null;
    const video = document.getElementById(VIDEO_ID) as HTMLVideoElement | null;
    if (video) { video.pause(); video.srcObject = null; }
    if (c) {
      try { await Promise.race([c.stop(), sleep(3000)]); } catch { /* router end must still run */ }
    }
  }, [VIDEO_ID]);

  /* Stop local playback immediately, then independently prove server cleanup. */
  const stop = useCallback(async (reason?: string) => {
    if (!isCurrent() || stopInFlight.current) return;
    stopInFlight.current = true;
    const stopRun = ++runRef.current;
    const id = sidRef.current;
    setPhase('stopping');
    setAck(false); setDeadline(null); setTokenExp(null);
    if (reason) setErr(reason);
    const sdkStop = stopClient();
    try {
      if (!id) {
        await sdkStop;
        if (isCurrent()) setPhase('idle');
        return;
      }
      const result = await requestAnamStop(
        () => endSession(id, { signal: AbortSignal.timeout(8000) }),
        () => {
          if (!isCurrent()) return Promise.reject(new Error('ACCOUNT_CHANGED'));
          return getSession(id, { signal: AbortSignal.timeout(8000) });
        },
        providerId,
      );
      await sdkStop;
      if (!isCurrent() || sidRef.current !== id || runRef.current !== stopRun) return;
      if (result.session) qc.setQueryData([...getGetSessionQueryKey(id), uid], result.session);
      setStopState(result.state);
      setPhase(result.state === 'confirmed' ? 'ended' : 'stop_unconfirmed');
      invalidate(id);
    } finally {
      stopInFlight.current = false;
    }
  }, [stopClient, invalidate, isCurrent, qc, uid, providerId]);
  const stopRef = useRef(stop); stopRef.current = stop;

  const refreshStopStatus = async () => {
    const id = sidRef.current;
    if (!id || checkingStop || !isCurrent()) return;
    setCheckingStop(true);
    const result = await confirmAnamStop(() => getSession(id, { signal: AbortSignal.timeout(8000) }), providerId);
    if (!isCurrent()) return;
    if (sidRef.current === id) {
      if (result.session) qc.setQueryData(sessionKey(id), result.session);
      setStopState(result.state);
      setPhase(result.state === 'confirmed' ? 'ended' : 'stop_unconfirmed');
      invalidate(id);
    }
    setCheckingStop(false);
  };

  const startAttempt = async () => {
    if (!ack || !uid || phase !== 'idle' && phase !== 'ended' && phase !== 'error') return;
    if (stopInFlight.current || checkingStop) return;
    if (sid && !hasConfirmedAnamStop(s, providerId)) return;
    const context = prepareRoleplay(roleplayEnabled, roleplayDraft);
    if (context.invalid) return;
    const run = ++runRef.current;
    const live = () => isCurrent() && runRef.current === run;
    setErr(null); setAck(false); setDeadline(null); setTokenExp(null); setStopState(null); setMessages([]);
    resetEvidence();
    setPhase('creating');

    let id = '';
    try {
      // A fresh free lookup closes the gap between list polling and a paid start.
      const check = await owned.refetch();
      if (!live()) return;
      if (check.error || !check.data) throw new Error(L('Could not confirm existing sessions. Refresh status before starting.', '기존 세션을 확인하지 못했습니다. 상태를 다시 확인한 뒤 시작하세요.'));
      if (anamRecoverySessions(check.data, providerId).length) { setPhase('idle'); return; }
      setRecovered(false); recoveredRef.current = false;
      const ns = await create.mutateAsync({ data: {
        providerId, avatarId: PERSONA_ID, pipeline: providerId === 'anam' ? 'anam_full' : 'tavus_full', mode: 'live', costConfirmed: true,
        ...context,
        ...(custom ? { avatarAssetId: custom.id, purpose: 'validation' as const } : {}),
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
      if (cur.status !== 'active' || cur.stopRequested) {
        setStopState(hasConfirmedAnamStop(cur, providerId) ? 'confirmed' : 'pending');
        setPhase(hasConfirmedAnamStop(cur, providerId) ? 'ended' : 'stop_unconfirmed');
        setErr(cur.error ?? L('Session stopped before it became ready.', '준비 전에 세션이 중단되었습니다.'));
        return;
      }
      if (cur.rendererState === 'running') break;
      if (Date.now() - t0 > QUEUE_TIMEOUT_MS) { void stopRef.current(L('Worker did not become ready in time. Session stopped; no retry.', '워커 준비 시간이 초과되어 세션을 종료했습니다. 재시도하지 않습니다.')); return; }
    }

    /* single connection request, no retry */
    setPhase('token');
    let connection: Awaited<ReturnType<typeof createClientConnection>>;
    try {
      const c = await createClientConnection(id);
      connection = c;
      if (!live()) return;
      setDeadline(new Date(c.expiresAt).getTime());
      if ('tokenExpiresAt' in c.connection) setTokenExp(c.connection.tokenExpiresAt);
    } catch (e) {
      if (live()) void stopRef.current(errMsg(e));
      return;
    }

    setPhase('connecting');
    try {
      const video = document.getElementById(VIDEO_ID) as HTMLVideoElement | null;
      if (!video) throw new Error('VIDEO_UNAVAILABLE');
      const client = createClient({
        connection, video,
        endSession: async (sessionId) => {
          if (!isCurrent()) throw new Error('ACCOUNT_CHANGED');
          return endSession(sessionId);
        },
        onAudioOwner: (owner) => { if (owner !== 'avatarrouter') throw new Error('VOICE_OWNER_MISMATCH'); },
        onMessages: (history) => { if (live()) setMessages(history); },
        onState: (state, code) => {
          if (!live()) return;
          if (state === 'connected') setPhase(p => p === 'playing' ? p : 'connected');
          if (state === 'playing') setPhase('playing');
          if (state === 'error') setErr(code ?? 'CLIENT_ERROR');
          // Local playback ending never certifies provider/server cleanup.
          if (state === 'ended') void stopRef.current();
        },
      });
      clientRef.current = client;
      await client.start();
      if (!live()) await client.stop();
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
    setDeadline(null); setTokenExp(null); setAck(false); setErr(null); setStopState(null);
    setPhase('recovered');
  }, [owned.data, sid, phase, isCurrent, qc, uid]);

  useEffect(() => {
    if (s && hasConfirmedAnamStop(s, providerId) && (recovered || phase === 'stop_unconfirmed')) {
      setStopState('confirmed'); setPhase('ended');
    }
  }, [recovered, s, phase]);

  /* Sample the actual media element: decoded frames, advancing time, unmuted live audio track. */
  useEffect(() => {
    if (!custom || phase !== 'playing') return;
    const video = document.getElementById(VIDEO_ID) as HTMLVideoElement | null;
    if (!video) return;
    let alive = true;
    const sample = () => {
      if (!alive) return;
      const src = video.srcObject instanceof MediaStream ? video.srcObject : null;
      const liveAudio = !!src?.getAudioTracks().some((tr) => tr.readyState === 'live' && tr.enabled);
      setEvidence((prev) => observe(prev, { readyState: video.readyState, videoWidth: video.videoWidth, currentTime: video.currentTime, muted: video.muted || video.volume === 0, liveAudio }));
    };
    type RVFC = (cb: () => void) => number;
    const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
    const loop = () => { sample(); if (alive && rvfc) rvfc(loop); };
    if (rvfc) rvfc(loop);
    video.addEventListener('timeupdate', sample);
    return () => { alive = false; video.removeEventListener('timeupdate', sample); };
  }, [custom, phase, VIDEO_ID]);

  const reportTarget = { uid, assetId: custom?.id ?? '', providerAvatarId: custom?.providerAvatarId ?? null, sid };
  const reportable = !!custom && !recovered && phase === 'playing' && reportedSid.current !== sid
    && canReport(reportTarget, s, evidence, heard, account.current);
  const submitReport = async () => {
    if (!custom || !reportable || reportInFlight.current) return;
    reportInFlight.current = true;
    const id = sid; const assetId = custom.id;
    const still = () => isCurrent() && sidRef.current === id;
    try {
      await report.mutateAsync({ id: assetId, data: { sessionId: id, videoObserved: true, audioObserved: true } });
      reportedSid.current = id;
      qc.invalidateQueries({ queryKey: getGetAvatarAssetQueryKey(assetId) });
      qc.invalidateQueries({ queryKey: getListAvatarAssetsQueryKey() });
      if (still()) setReportState({ kind: 'ok', sid: id });
    } catch (e) {
      if (still()) setReportState({ kind: 'fail', msg: errMsg(e), sid: id });
    } finally {
      reportInFlight.current = false;
      report.reset();
    }
  };

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
    if (s && (s.status !== 'active' || s.stopRequested) && clientRef.current) {
      runRef.current++;
      const confirmed = hasConfirmedAnamStop(s, providerId);
      setStopState(confirmed ? 'confirmed' : 'pending');
      setPhase(confirmed ? 'ended' : 'stop_unconfirmed');
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
        if (c) void c.stop().catch(() => {});
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
  const recoveredPending = recovered && (!s || needsAnamRecovery(s, providerId));
  const stopUnconfirmed = phase === 'stop_unconfirmed';
  const cleanupPending = !!s?.cleanupPending || (limits.data?.cleanupPending ?? 0) > 0;
  const lim = limits.data;
  const canStart = ack && !busy && phase !== 'stopping' && !create.isPending && !!lim?.workerReady && lim.creationAllowed !== false
    && lim.userRemainingSeconds >= STOP_DEADLINE_S && lim.globalRemainingSeconds >= STOP_DEADLINE_S && !cleanupPending && !preparedRoleplay.invalid
    && owned.isSuccess && !owned.isError && !session.isError && !recoverable.length && !recoveredPending
    && !stopUnconfirmed && !stopInFlight.current && !checkingStop && (!sid || hasConfirmedAnamStop(s, providerId));

  const steps: { k: string; on: boolean; label: string }[] = [
    { k: 'queued', on: ['queued', 'token', 'connecting', 'connected', 'playing'].includes(phase), label: L('worker', '워커') },
    { k: 'token', on: ['connecting', 'connected', 'playing'].includes(phase), label: L('token ready', '토큰 준비') },
    { k: 'conn', on: ['connected', 'playing'].includes(phase), label: L('connected', '연결됨') },
    { k: 'video', on: phase === 'playing', label: L('video playing', '영상 재생') },
  ];

  return (
    <div id={custom ? 'tavus-asset' : providerId} className="rise mb-8">
      <Panel
        title={<span className="flex items-center gap-2"><Radio className="h-3.5 w-3.5 text-primary" />{providerName} · {custom ? L('custom avatar validation', '커스텀 아바타 검증') : L('AvatarRouter live conversation', 'AvatarRouter 라이브 대화')}</span>}
        aside={<span className="mono text-[10.5px] text-muted-foreground">{L('Managed voice + dialogue', '라우터가 음성·대화 연동 관리')}</span>}
      >
        {!uid ? (
          <div className="flex flex-wrap items-center justify-between gap-4 p-5" data-testid="anam-signed-out">
            <p className="max-w-lg text-sm text-muted-foreground">{L('Live conversations consume paid provider credits and require sign-in.', '라이브 대화는 유료 제공자 크레딧을 사용하므로 로그인이 필요합니다.')}</p>
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
                  <div className="break-all text-lg font-bold" data-testid="text-anam-persona">{custom ? custom.name : persona?.name ?? (avatars.isLoading ? '…' : providerName)}</div>
                  <div className="mono break-all text-[10.5px] text-muted-foreground">{providerId} · {custom ? `${PERSONA_ID} · ${L('validation', '검증')}` : persona?.id ?? PERSONA_ID}{!custom && persona && !persona.configured ? ` · ${L('not configured', '미설정')}` : ''}</div>
                </div>
                {stopUnconfirmed
                  ? <Pill value="failed" label={L('Stop unconfirmed', '종료 확인 필요')} />
                  : s ? <Pill value={s.status} live={s.status === 'active'} /> : <Pill value="ended" label={L('idle', '대기')} />}
              </div>

              {owned.isPending && <p className="text-xs text-muted-foreground" role="status">{L(`Checking your existing ${providerName} sessions…`, `기존 ${providerName} 세션을 확인하고 있습니다…`)}</p>}
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
                  <p className="font-semibold">{L(`Previous ${providerName} session found`, `이전 ${providerName} 세션을 찾았습니다`)}</p>
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
                          setPhase('recovered'); setErr(null); setStopState(null);
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
                  {L('Provider cleanup is not confirmed yet. New paid sessions remain blocked; a request being accepted is not completion.', '공급자 정리가 아직 확인되지 않았습니다. 새 유료 세션은 차단되며, 종료 요청 접수가 완료를 의미하지는 않습니다.')}
                </div>
              )}

              {stopUnconfirmed && (
                <div className="space-y-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="anam-stop-unconfirmed">
                  <p className="font-semibold">{L('Playback stopped · server stop unconfirmed', '재생 중단 · 서버 종료 확인 필요')}</p>
                  <p className="text-xs">{stopState === 'unconfirmed'
                    ? L('The stop request or status lookup could not be confirmed. The session is not marked complete and paid starts stay blocked.',
                      '종료 요청 또는 상태 조회를 확인하지 못했습니다. 완료로 표시하지 않으며 새 유료 시작을 차단합니다.')
                    : L('The server still reports an active session or unfinished cleanup. Wait for confirmed cleanup, or explicitly retry the stop request.',
                      '서버에서 활성 세션 또는 미완료 정리 상태가 확인됩니다. 정리 확인을 기다리거나 종료 요청을 다시 할 수 있습니다.')}</p>
                  <button type="button" disabled={checkingStop} onClick={() => void refreshStopStatus()}
                    className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40" data-testid="button-anam-stop-check">
                    {checkingStop ? L('Checking…', '확인 중…') : L('Check status only · no new session', '상태만 다시 확인 · 새 세션 생성 없음')}
                  </button>
                </div>
              )}
              {stopState === 'confirmed' && phase === 'ended' && (
                <p className="rounded border p-3 text-xs text-muted-foreground" role="status" data-testid="anam-stop-confirmed">
                  {L('Server cleanup confirmed. Starting another session still requires cost consent and the normal capacity checks.',
                    '서버 정리 완료를 확인했습니다. 새 세션에는 비용 동의와 기존 용량 확인이 다시 필요합니다.')}
                </p>
              )}

              <div className="flex items-start gap-2 rounded border p-3 text-[12px] text-muted-foreground">
                <MessagesSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{L('AvatarRouter connects the selected voice and dialogue engine. Gemini is not run concurrently. Microphone access is requested, never camera access. Text transcripts may be retained by the provider.', 'AvatarRouter가 선택한 음성·대화 엔진을 연결합니다. Gemini를 동시에 실행하지 않습니다. 마이크 권한만 요청하고 카메라는 요청하지 않습니다. 대화 텍스트는 제공자에 보관될 수 있습니다.')}</span>
              </div>

              <AnamRoleplayFields enabled={roleplayEnabled} draft={roleplayDraft}
                onEnabled={setRoleplayEnabled} onDraft={setRoleplayDraft} L={L}
                providerName={providerName} allowDefaultPersona={providerId === 'anam'} />
              {preparedRoleplay.invalid && (
                <p role="status" className="text-xs text-destructive" data-testid="anam-roleplay-validation">
                  {L('Complete the required roleplay fields and check their length before starting.',
                    '시작 전에 필수 역할 입력과 글자 수 제한을 확인하세요.')}
                </p>
              )}

              {!busy && !recoveredPending && !stopUnconfirmed && phase !== 'stopping' && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded border border-primary/40 bg-primary/5 p-3 text-[12.5px]">
                  <input type="checkbox" data-testid="checkbox-anam-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span>{L('This may consume provider credits. One session, one connection attempt, no automatic retry or reconnect. It is stopped at the router deadline.', '제공자 크레딧이 사용될 수 있습니다. 세션 1개, 연결 시도 1회이며 자동 재시도·재연결은 없습니다. 라우터 기한에 종료됩니다.')}</span>
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                {!busy && !recoveredPending && !stopUnconfirmed && phase !== 'stopping' ? (
                  <button data-testid="button-anam-start" disabled={!canStart} onClick={() => void start()}
                    className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97] disabled:opacity-40">
                    <Play className="h-4 w-4" /> {providerName} {L('Start live', '라이브 시작')}
                  </button>
                ) : (
                  <button data-testid="button-anam-stop" disabled={phase === 'stopping'} onClick={() => void stop()}
                    className="inline-flex items-center gap-2 rounded border border-destructive/40 px-4 py-2 text-sm text-destructive transition hover:bg-destructive/5 active:scale-[.97] disabled:opacity-40">
                    <Square className="h-4 w-4" /> {phase === 'stopping' ? L('Stopping…', '종료 중…') : stopUnconfirmed ? L('Retry stop request', '종료 요청 다시 하기') : L('Stop', '종료')}
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
              {custom && (
                <div className="space-y-2 rounded border border-primary/40 p-3 text-xs" data-testid="panel-asset-validation">
                  <div className="eyebrow">{L('Playback evidence', '재생 증거')}</div>
                  <p className="text-muted-foreground">{L('Validation session over Tavus full pipeline (Daily, no LiveKit). Connected or playing alone is not evidence; the report needs moving frames, an unmuted live audio track, and your confirmation.',
                    'Tavus 전체 파이프라인(Daily, LiveKit 불필요) 검증 세션입니다. 연결·재생 상태만으로는 증거가 아니며, 움직이는 프레임·음소거되지 않은 라이브 오디오 트랙·관리자 확인이 필요합니다.')}</p>
                  <ul className="mono space-y-0.5 text-[11px]">
                    <li data-testid="status-evidence-video">{evidence.video ? '[x]' : '[ ]'} {L('video frames advancing', '영상 프레임 진행')}</li>
                    <li data-testid="status-evidence-audio">{evidence.audio ? '[x]' : '[ ]'} {L('unmuted live audio track', '음소거 아닌 라이브 오디오 트랙')}</li>
                  </ul>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" data-testid="checkbox-heard-voice" checked={heard} disabled={phase !== 'playing' || !evidence.video || !evidence.audio}
                      onChange={(e) => setHeard(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                    <span>{L('I heard the avatar speak back in this session.', '이 세션에서 아바타의 응답 음성을 직접 들었습니다.')}</span>
                  </label>
                  <button type="button" data-testid="button-report-validation" disabled={!reportable || report.isPending} onClick={() => void submitReport()}
                    className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition active:scale-[.97] disabled:opacity-40">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {report.isPending ? L('Reporting…', '기록 중…') : L('Report playback validated', '재생 검증 기록')}
                  </button>
                  {reportState?.sid === sid && reportState.kind === 'ok' && <p role="status" className="text-primary" data-testid="text-report-success">{L('Playback report recorded for this asset.', '이 에셋의 재생 검증이 기록되었습니다.')}</p>}
                  {reportState?.sid === sid && reportState.kind === 'fail' && <p role="alert" className="text-destructive" data-testid="text-report-error">{L('Report not recorded', '기록 실패')}: {reportState.msg}</p>}
                </div>
              )}
              {messages.length > 0 && <section className="space-y-2 text-sm" aria-live="polite">
                <h3 className="font-semibold">{L('Live captions · provisional', '실시간 대화 · 임시 자막')}</h3>
                <ol className="max-h-60 space-y-2 overflow-auto">{messages.map(m => <li key={m.id}>
                  <strong>{m.role === 'user' ? L('User', '사용자') : L('Avatar', '아바타')}: </strong>{m.text}
                </li>)}</ol>
              </section>}
            </div>
          </div>
        )}
      </Panel>
      {sid && <SessionTranscript key={sid} id={sid} />}
    </div>
  );
}
