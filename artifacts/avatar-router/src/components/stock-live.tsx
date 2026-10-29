import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Room, RoomEvent, Track, ConnectionState, type RemoteTrack } from 'livekit-client';
import { AudioLines, LogIn, Mic, Play, Radio, Square, Volume2, Zap } from 'lucide-react';
import {
  useCreateSession, useGetSession, useEndSession, useInterruptSession, useGetLiveConnection, useSendLiveAudio, useGetLiveLimits,
  getGetSessionQueryKey, getGetLiveConnectionQueryKey, getListSessionsQueryKey, getGetUsageQueryKey, getListSessionEventsQueryKey, getGetLiveLimitsQueryKey,
  useReportAvatarLiveValidation, getGetAvatarAssetQueryKey, getListAvatarAssetsQueryKey,
  type AvatarAsset,
} from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { Panel, Pill, errMsg, fmtSec } from '@/components/bits';
import { cn } from '@/lib/utils';

const KEY = 'ar-stock-session';
const STOCK_ID = 'tavus-stock-lucy';
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function useL() {
  const { lang } = useI18n();
  return (en: string, ko: string) => (lang === 'en' ? en : ko);
}

/* PCM helpers: capture float32 at device rate -> 24 kHz mono int16 LE -> base64 */
function toPcm24kBase64(chunks: Float32Array[], rate: number): string {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const src = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { src.set(c, o); o += c.length; }
  const ratio = rate / 24000;
  const outLen = Math.min(Math.floor(len / ratio), 24000 * 5);
  const buf = new DataView(new ArrayBuffer(outLen * 2));
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio; const i0 = Math.floor(p); const f = p - i0;
    const v = (src[i0] ?? 0) * (1 - f) + (src[i0 + 1] ?? src[i0] ?? 0) * f;
    const s = Math.max(-1, Math.min(1, v));
    buf.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function StockLivePanel({ asset }: { asset?: AvatarAsset }) {
  const L = useL();
  const { user, isLoaded } = useUser();
  const qc = useQueryClient();
  const uid = user?.id ?? null;
  const limits = useGetLiveLimits({ query: { queryKey: [...getGetLiveLimitsQueryKey(), uid], enabled: !!uid, refetchInterval: 5000, staleTime: 0 } });

  const [sid, setSid] = useState<string>(() => sessionStorage.getItem(KEY) ?? '');
  const [ack, setAck] = useState(false);
  const [playbackAck, setPlaybackAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<string>('disconnected');
  const [hasVideo, setHasVideo] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [firstFrame, setFirstFrame] = useState(false);
  const [needsAudio, setNeedsAudio] = useState(false);
  const [rec, setRec] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [recLeft, setRecLeft] = useState(5);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const sidRef = useRef(sid); sidRef.current = sid;
  const activeRef = useRef(false);
  const stopRecRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (sid) sessionStorage.setItem(KEY, sid); else sessionStorage.removeItem(KEY);
  }, [sid]);

  const session = useGetSession(sid, {
    query: {
      queryKey: getGetSessionQueryKey(sid),
      enabled: !!sid && !!uid,
      refetchInterval: (q) => (q.state.data?.status === 'active' || q.state.data?.cleanupPending ? 2000 : false),
    },
  });
  const s = session.data;
  const active = s?.status === 'active';
  const ready = active && s?.rendererState === 'running' && !s.stopRequested;
  activeRef.current = active;

  const conn = useGetLiveConnection(sid, {
    query: {
      queryKey: getGetLiveConnectionQueryKey(sid),
      enabled: !!sid && !!uid && ready,
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    },
  });

  const invalidate = (id: string) => {
    qc.invalidateQueries({ queryKey: getGetSessionQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionEventsQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetUsageQueryKey() });
  };

  const create = useCreateSession();
  const end = useEndSession();
  const interrupt = useInterruptSession();
  const send = useSendLiveAudio();
  const report = useReportAvatarLiveValidation();
  const supported = !asset || (asset.providerId === 'tavus' && asset.status === 'ready' && !!asset.providerAvatarId);
  useEffect(() => { setAck(false); setPlaybackAck(false); }, [asset?.id, sid, uid]);
  const endMutateRef = useRef(end.mutate); endMutateRef.current = end.mutate;

  const disconnect = useCallback(() => {
    const r = roomRef.current;
    roomRef.current = null;
    if (r) {
      r.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => pub.track?.detach()));
      void r.disconnect();
    }
    setRoomState('disconnected'); setHasVideo(false); setHasAudio(false); setFirstFrame(false); setNeedsAudio(false);
  }, []);

  /* auth switch: drop browser room + stale selection; server TTL bounds billing */
  const prevUid = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    if (prevUid.current !== undefined && prevUid.current !== uid) {
      const previousSession = sidRef.current;
      if (previousSession && activeRef.current) {
        void fetch(`${basePath}/api/v1/sessions/${previousSession}/end`, {
          method: 'POST', credentials: 'include', keepalive: true,
        }).catch(() => {});
      }
      stopRecRef.current?.();
      disconnect();
      setSid(''); setAck(false); setErr(null);
    }
    if (prevUid.current === undefined && !uid) setSid('');
    prevUid.current = uid;
  }, [uid, isLoaded, disconnect]);

  /* connect room (subscribe only) */
  const url = conn.data?.url; const token = conn.data?.token;
  useEffect(() => {
    if (!active || !url || !token || !uid) return;
    // A first-frame placeholder and background preview must not suppress the
    // initial subscription through viewport-based adaptive pausing.
    const room = new Room({ adaptiveStream: false });
    roomRef.current = room;
    let cancelled = false;

    const attach = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video && videoRef.current) {
        track.attach(videoRef.current); setHasVideo(true);
        const v = videoRef.current as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { if (!cancelled) setFirstFrame(true); });
        else v.addEventListener('loadeddata', () => setFirstFrame(true), { once: true });
        void v.play().catch(() => {});
      } else if (track.kind === Track.Kind.Audio && audioRef.current) {
        track.attach(audioRef.current); setHasAudio(true);
      }
    };
    const detach = (track: RemoteTrack) => {
      track.detach();
      if (track.kind === Track.Kind.Video) { setHasVideo(false); setFirstFrame(false); }
      else if (track.kind === Track.Kind.Audio) setHasAudio(false);
    };

    room
      .on(RoomEvent.ConnectionStateChanged, (st: ConnectionState) => setRoomState(st))
      .on(RoomEvent.TrackSubscribed, (t) => attach(t))
      .on(RoomEvent.TrackUnsubscribed, (t) => detach(t))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudio(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, (reason) => {
        if (!cancelled && activeRef.current && roomRef.current === room) setErr(`LiveKit disconnected (${reason ?? 'transport closed'}).`);
        setRoomState('disconnected'); setHasVideo(false); setHasAudio(false); setFirstFrame(false);
      });

    room.connect(url, token, { autoSubscribe: true })
      .then(() => {
        if (cancelled) return;
        room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => {
          if (pub.isSubscribed && pub.track) attach(pub.track as RemoteTrack);
          else pub.setSubscribed(true);
        }));
        setNeedsAudio(!room.canPlaybackAudio);
      })
      .catch((e) => { if (!cancelled) setErr(errMsg(e)); });

    return () => {
      cancelled = true;
      room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => pub.track?.detach()));
      void room.disconnect();
      if (roomRef.current === room) roomRef.current = null;
    };
  }, [active, url, token, uid]);

  /* session ended server-side -> drop room */
  useEffect(() => {
    if (s && s.status !== 'active') { stopRecRef.current?.(); disconnect(); }
  }, [s?.status, s, disconnect]);

  /* pagehide: best-effort keepalive end (reload ends the session; rehydrate then shows ended) */
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      const id = sidRef.current;
      if (!id || !activeRef.current) return;
      try {
        void fetch(`${basePath}/api/v1/sessions/${id}/end`, { method: 'POST', keepalive: true, credentials: 'include' });
      } catch { /* backend TTL is the hard stop */ }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  /* SPA unmount: end to bound billing. Deferred so StrictMode remount does not end it. */
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = sidRef.current; const wasActive = activeRef.current;
      setTimeout(() => {
        if (mounted.current) return;
        stopRecRef.current?.();
        if (id && wasActive) endMutateRef.current({ id });
      }, 0);
    };
  }, []);

  const start = () => {
    if (!ack || !uid || !supported) return;
    setErr(null);
    send.reset(); report.reset();
    create.mutate(
      { data: {
        providerId: 'tavus', avatarId: asset?.providerAvatarId ?? STOCK_ID,
        ...(asset ? { avatarAssetId: asset.id, purpose: asset.liveValidation?.status === 'validated' ? 'conversation' as const : 'validation' as const } : {}),
        mode: 'live', costConfirmed: true,
      } },
      {
        onSuccess: (ns) => { setSid(ns.id); invalidate(ns.id); },
        onError: (e) => { setErr(errMsg(e)); qc.invalidateQueries({ queryKey: getGetUsageQueryKey() }); },
      },
    );
  };
  const doEnd = () => {
    stopRecRef.current?.();
    disconnect();
    end.mutate({ id: sid }, { onSuccess: () => invalidate(sid), onError: (e) => setErr(errMsg(e)) });
  };
  const doInterrupt = () => interrupt.mutate({ id: sid }, { onSuccess: () => invalidate(sid), onError: (e) => setErr(errMsg(e)) });
  const tone = () => { setErr(null); send.mutate({ id: sid, data: { sample: true } }, { onSuccess: () => invalidate(sid), onError: (e) => setErr(errMsg(e)) }); };

  const record = async () => {
    setErr(null);
    setRec('recording');
    let stream: MediaStream | null = null; let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null; let done = false;
    let cancelled = false;
    // Permission dialogs can outlive End, sign-out or navigation.
    stopRecRef.current = () => { cancelled = true; setRec('idle'); };
    const chunks: Float32Array[] = [];
    const cleanup = () => {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx && ctx.state !== 'closed') void ctx.close();
      stopRecRef.current = null;
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (cancelled || !mounted.current || !activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setRec('idle');
        return;
      }
      ctx = new AudioContext();
      const srcNode = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const rate = ctx.sampleRate;
      proc.onaudioprocess = (ev) => { if (!done) chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); };
      srcNode.connect(proc); proc.connect(ctx.destination);
      setRec('recording'); setRecLeft(5);
      const t0 = performance.now();
      const finish = (upload: boolean) => {
        if (done) return; done = true;
        proc.disconnect(); srcNode.disconnect();
        cleanup();
        if (!upload) { setRec('idle'); return; }
        const id = sidRef.current;
        if (!id || !activeRef.current || !chunks.length) { setRec('idle'); return; }
        setRec('sending');
        const pcmBase64 = toPcm24kBase64(chunks, rate);
        send.mutate({ id, data: { pcmBase64 } }, {
          onSuccess: () => invalidate(id),
          onError: (e) => setErr(errMsg(e)),
          onSettled: () => setRec('idle'),
        });
      };
      stopRecRef.current = () => finish(false);
      timer = setInterval(() => {
        const left = 5 - (performance.now() - t0) / 1000;
        setRecLeft(Math.max(0, Math.ceil(left)));
        if (left <= 0) finish(true);
      }, 200);
      stopEarlyRef.current = () => finish(true);
    } catch (e) {
      cleanup(); setRec('idle'); setErr(errMsg(e));
    }
  };
  const stopEarlyRef = useRef<(() => void) | null>(null);

  const startAudio = () => { void roomRef.current?.startAudio().then(() => setNeedsAudio(false)).catch((e) => setErr(errMsg(e))); };

  if (!isLoaded) return null;

  const live = active && roomState === 'connected';
  const remaining = s ? Math.max(0, Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 1000)) : 0;

  return (
    <div id="stock" className="rise mb-8">
      <Panel
        title={<span className="flex items-center gap-2"><Radio className="h-3.5 w-3.5 text-primary" />{asset ? L('Custom avatar live validation', '커스텀 아바타 라이브 검증') : L('Stock live test · Tavus', '기본 아바타 라이브 테스트 · Tavus')}</span>}
        aside={<span className="mono text-[10.5px] text-muted-foreground">{asset ? asset.liveValidation?.status ?? 'unvalidated' : L('independent of selected asset', '선택된 에셋과 무관')}</span>}
      >
        {!uid ? (
          <div className="flex flex-wrap items-center justify-between gap-4 p-5" data-testid="stock-signed-out">
            <p className="max-w-lg text-sm text-muted-foreground">{L('Live stock sessions use paid provider and LiveKit capacity, so they require sign-in.', '기본 아바타 라이브 세션은 유료 프로바이더와 LiveKit 용량을 사용하므로 로그인이 필요합니다.')}</p>
            <Link href="/sign-in" data-testid="link-stock-sign-in" className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97]">
              <LogIn className="h-4 w-4" /> {L('Sign in', '로그인')}
            </Link>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="relative aspect-video bg-sidebar text-sidebar-foreground">
              <video ref={videoRef} autoPlay playsInline muted className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', hasVideo && firstFrame ? 'opacity-100' : 'opacity-0')} data-testid="video-stock" />
              <audio ref={audioRef} autoPlay className="hidden" />
              {!(hasVideo && firstFrame) && (
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <div className="mono text-[10.5px] uppercase tracking-widest opacity-60">
                      {!active ? L('no live session', '라이브 세션 없음') : roomState !== 'connected' ? L(`room: ${roomState}`, `룸: ${roomState}`) : hasVideo ? L('waiting for first frame', '첫 프레임 대기') : L('connected, waiting for avatar track', '연결됨, 아바타 트랙 대기')}
                    </div>
                    <p className="mt-2 max-w-xs text-xs opacity-50">{L('Only a real subscribed remote track is shown here. No still image stands in for live video.', '실제 구독된 원격 트랙만 표시됩니다. 정지 이미지는 라이브 영상으로 표시되지 않습니다.')}</p>
                  </div>
                </div>
              )}
              <div className="mono absolute left-3 top-3 flex gap-1.5 text-[10px]">
                <span className={cn('rounded-sm px-1.5 py-0.5', live ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent')}>{roomState}</span>
                <span className="rounded-sm bg-sidebar-accent px-1.5 py-0.5">video {hasVideo ? (firstFrame ? 'frames' : 'track') : '—'}</span>
                <span className="rounded-sm bg-sidebar-accent px-1.5 py-0.5">audio {hasAudio ? 'track' : '—'}</span>
              </div>
              {needsAudio && hasAudio && (
                <button onClick={startAudio} data-testid="button-start-audio" className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground active:scale-[.97]">
                  <Volume2 className="h-3.5 w-3.5" /> {L('Enable audio', '오디오 켜기')}
                </button>
              )}
            </div>

            <div className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="break-all text-lg font-bold">{asset?.name ?? 'Lucy - Home'}</div>
                  <div className="mono break-all text-[10.5px] text-muted-foreground">{s && active ? `${s.providerId} · ${s.avatarId}` : `${asset?.providerId ?? 'tavus'} · ${asset?.providerAvatarId ?? STOCK_ID}`}</div>
                </div>
                {s ? <Pill value={s.status} live={active} /> : <Pill value="ended" label={L('idle', '대기')} />}
              </div>
              {s && <div className="mono text-xs text-muted-foreground" data-testid="text-stock-duration">{fmtSec(s.durationSeconds)} · {active ? L(`${remaining}s until hard stop`, `강제 종료까지 ${remaining}초`) : s.status}{s.error ? ` · ${s.error}` : ''}</div>}
              {s && active && !ready && <p className="text-xs text-muted-foreground" role="status">{s.stopRequested ? L('Stop requested. Waiting for confirmed remote cleanup.', '종료 요청을 저장했습니다. 원격 정리 확인을 기다리는 중입니다.') : L('Dedicated renderer is starting…', '전용 렌더러를 시작하는 중입니다…')}</p>}
              {limits.data && <div className="rounded border p-3 text-xs text-muted-foreground" data-testid="text-live-budget">
                <p>{L('Daily time budget remaining', '오늘 남은 사용 시간')}: {L('You', '사용자')} {limits.data.userRemainingSeconds}s / {limits.data.userDailySeconds}s · {L('Service', '전체')} {limits.data.globalRemainingSeconds}s / {limits.data.globalDailySeconds}s</p>
                <p className="mt-1">{L('Each attempt reserves 120 s; resets at 00:00 UTC. Provider credit balance is unavailable here; check Tavus/LiveKit billing.', '시도당 120초를 예약하며 UTC 00:00에 초기화됩니다. 공급자 잔여 크레딧은 여기서 조회할 수 없습니다. Tavus/LiveKit 결제 화면을 확인하세요.')}</p>
                {!limits.data.workerReady && <p className="mt-1 text-destructive">{L('Renderer worker unavailable. Paid starts are blocked.', '렌더러 워커가 응답하지 않아 유료 시작을 차단했습니다.')}</p>}
              </div>}
              {(s?.cleanupPending || (limits.data?.cleanupPending ?? 0) > 0) && <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert" data-testid="warning-live-cleanup">
                {s?.error === 'LIVE_CREATE_RECONCILIATION_REQUIRED'
                  ? L('Paid creation outcome is unknown. Do not create another session. An operator must reconcile it with the provider.', '유료 생성 결과가 불명확합니다. 새 세션을 만들지 마세요. 운영자가 공급자 기록을 확인해야 합니다.')
                  : L('Remote session cleanup is not confirmed. Billing may continue. The worker retries known provider termination and room deletion; new paid sessions remain blocked.', '원격 세션 정리가 확인되지 않아 과금이 계속될 수 있습니다. 워커가 확인된 공급자 세션 종료와 방 삭제를 재시도하며 새 유료 세션은 차단합니다.')}
              </div>}
              {s?.error === 'LIVE_QUOTA_OR_PLAN_REQUIRED' && <p className="text-sm text-destructive" role="alert">{L('Provider rejected usage. Check remaining credits and plan entitlement in Tavus/LiveKit. No paid retry was made.', '공급자가 사용을 거절했습니다. Tavus/LiveKit 잔여 크레딧과 요금제 권한을 확인하세요. 유료 재시도는 하지 않았습니다.')}</p>}

              {!active && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded border border-primary/40 bg-primary/5 p-3 text-[12.5px]">
                  <input type="checkbox" data-testid="checkbox-stock-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span>{asset ? L(
                    'This starts a paid, bounded live session for the selected existing asset. No new training or image upload. A ready asset is not playback-validated. This only renders supplied audio; it does not start an AI conversation.',
                    '선택한 기존 자산으로 유료 라이브 세션을 시작합니다(최대 120초). 새 학습이나 이미지 업로드는 없습니다. 생성 완료는 재생 검증 완료가 아닙니다. 보낸 오디오만 렌더링하며 AI 대화는 시작하지 않습니다.',
                  ) : L(
                    'This uses provider and LiveKit credits. The session expires automatically after 120 s total (roughly 90 s live). Stock avatar only: no custom training or image upload. No AI dialogue: the avatar only echoes the audio you send, with lip-sync.',
                    '프로바이더 및 LiveKit 크레딧이 사용됩니다. 세션은 총 120초 후 자동 만료됩니다(라이브 약 90초). 기본 아바타 전용: 커스텀 학습이나 이미지 업로드가 없습니다. AI 대화 없음: 아바타는 보낸 오디오를 립싱크로 따라 말할 뿐입니다.',
                  )}</span>
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                {!active ? (
                  <button data-testid="button-stock-start" disabled={!supported || !ack || create.isPending || !limits.data?.workerReady || limits.data.userRemainingSeconds < 120 || limits.data.globalRemainingSeconds < 120 || limits.data.cleanupPending > 0} onClick={start}
                    className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97] disabled:opacity-40">
                    <Play className="h-4 w-4" /> {create.isPending ? L('Starting…', '시작 중…') : asset ? L('Start selected avatar', '선택한 아바타 시작') : L('Start Lucy live', 'Lucy 라이브 시작')}
                  </button>
                ) : (
                  <button data-testid="button-stock-end" disabled={end.isPending || s?.stopRequested} onClick={doEnd}
                    className="inline-flex items-center gap-2 rounded border border-destructive/40 px-4 py-2 text-sm text-destructive transition hover:bg-destructive/5 active:scale-[.97] disabled:opacity-40">
                    <Square className="h-4 w-4" /> {L('End', '종료')}
                  </button>
                )}
                <button data-testid="button-stock-interrupt" disabled={!ready || interrupt.isPending} onClick={doInterrupt}
                  className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm transition hover:bg-muted active:scale-[.97] disabled:opacity-40">
                  <Zap className="h-4 w-4" /> {L('Interrupt', '중단')}
                </button>
              </div>

              <div className="border-t pt-4">
                <div className="eyebrow mb-2">{L('Send audio to echo', '따라 말할 오디오 보내기')}</div>
                <div className="flex flex-wrap gap-2">
                  <button data-testid="button-stock-tone" disabled={!ready || send.isPending || rec !== 'idle'} onClick={tone}
                    className="inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm transition hover:bg-muted active:scale-[.97] disabled:opacity-40">
                    <AudioLines className="h-4 w-4" /> {L('1 s test tone', '1초 테스트 톤')}
                  </button>
                  {rec === 'recording' ? (
                    <button data-testid="button-stock-rec-stop" onClick={() => stopEarlyRef.current?.()}
                      className="inline-flex items-center gap-2 rounded bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground active:scale-[.97]">
                      <span className="relative h-2 w-2 rounded-full bg-current ping" /> {L(`Stop and send (${recLeft}s)`, `중지 후 전송 (${recLeft}초)`)}
                    </button>
                  ) : (
                    <button data-testid="button-stock-rec" disabled={!ready || rec !== 'idle' || send.isPending} onClick={record}
                      className="inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm transition hover:bg-muted active:scale-[.97] disabled:opacity-40">
                      <Mic className="h-4 w-4" /> {rec === 'sending' ? L('Uploading…', '업로드 중…') : L('Record my voice (max 5 s)', '내 목소리 녹음 (최대 5초)')}
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{L('The tone is a synthetic beep, not speech. Uploaded PCM is kept briefly in private storage for the worker and then deleted. The microphone is never published to the room.', '톤은 합성 비프음이며 음성이 아닙니다. 업로드된 PCM은 워커 전달을 위해 비공개 저장소에 잠시 보관한 뒤 삭제합니다. 마이크는 룸에 게시되지 않습니다.')}</p>
              </div>

              {asset && !supported && <p className="text-sm text-destructive" role="alert">{L('This asset is not ready or its live runtime is not supported. Anam custom playback remains unavailable.', '자산이 준비되지 않았거나 라이브 런타임이 지원되지 않습니다. Anam 커스텀 재생은 아직 사용할 수 없습니다.')}</p>}
              {asset && s?.avatarAssetId === asset.id && s.purpose === 'validation' && (
                <div className="space-y-2 rounded border p-3 text-xs" data-testid="panel-playback-validation">
                  <p>{L('Playback report: server checks the exact asset, live session and completed audio command. This is an operator report, not independent provider certification.', '재생 확인 기록: 서버가 해당 자산·라이브 세션·오디오 명령 완료를 검사합니다. 운영자의 재생 확인이며 공급자의 별도 인증은 아닙니다.')}</p>
                  <label className="flex items-start gap-2">
                    <input type="checkbox" checked={playbackAck} onChange={e => setPlaybackAck(e.target.checked)} disabled={!ready || !firstFrame || !hasAudio || !send.isSuccess || needsAudio} data-testid="checkbox-playback-confirm" />
                    {L('I saw moving video and heard the returned audio.', '실제 움직이는 영상과 반환된 소리를 확인했습니다.')}
                  </label>
                  <button data-testid="button-report-playback" disabled={!playbackAck || !ready || !firstFrame || !hasAudio || !send.isSuccess || needsAudio || report.isPending} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => {
                    report.mutate({ id: asset.id, data: { sessionId: sid, videoObserved: true, audioObserved: true } }, {
                      onSuccess: () => {
                        qc.invalidateQueries({ queryKey: getGetAvatarAssetQueryKey(asset.id) });
                        qc.invalidateQueries({ queryKey: getListAvatarAssetsQueryKey() });
                      },
                      onError: e => setErr(errMsg(e)),
                    });
                  }}>{L('Save playback validation', '재생 검증 기록 저장')}</button>
                  {report.isSuccess && <p role="status">{L('Playback report saved. End this test and wait for confirmed cleanup.', '재생 확인을 저장했습니다. 테스트를 종료하고 원격 정리 완료를 확인하세요.')}</p>}
                </div>
              )}

              {(err || conn.isError) && (
                <div className="rounded border border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/5 p-3" data-testid="text-stock-error">
                  <div className="mono text-[11px] uppercase tracking-wider text-[hsl(var(--warn))]">{L('server response', '서버 응답')}</div>
                  <p className="mt-1 text-sm">{err ?? errMsg(conn.error)}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
