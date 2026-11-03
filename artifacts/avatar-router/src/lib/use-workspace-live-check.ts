import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import {
  useGetWorkspaceLiveCheck, getGetWorkspaceLiveCheckQueryKey, getWorkspaceLiveCheck,
  startWorkspaceLiveCheck, getWorkspaceLiveConnection, sendWorkspaceLiveSample, endWorkspaceLiveCheck,
  getGetDeveloperWorkspaceQueryKey, type WorkspaceLiveCheck,
} from '@workspace/api-client-react';
import type { LiveCheckView } from './workspace-live-check-view';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function useWorkspaceLiveCheck(projectId: string): LiveCheckView {
  const { user } = useUser();
  const qc = useQueryClient();
  const key = [...getGetWorkspaceLiveCheckQueryKey(projectId), user?.id];
  const storageKey = `ar-workspace-probe:${user?.id}:${projectId}`;
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<LiveCheckView['phase']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [videoFrames, setVideoFrames] = useState(0);
  const [audioBytes, setAudioBytes] = useState(0);
  const [audioEnergy, setAudioEnergy] = useState(0);
  const [sampleCompleted, setSampleCompleted] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [heard, setHeard] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const roomRef = useRef<Room | null>(null);
  const runRef = useRef<{ cancelled: boolean; id: string | null } | null>(null);
  const mounted = useRef(true);
  const query = useGetWorkspaceLiveCheck(projectId, { query: {
    queryKey: key, enabled: !!user, retry: false, staleTime: 0, gcTime: 0, refetchInterval: 4000,
  } });
  const state = query.data;

  const recover = async () => {
    const result = await getWorkspaceLiveCheck(projectId, { signal: AbortSignal.timeout(8000) });
    if (mounted.current) qc.setQueryData(key, result);
    return result;
  };

  // An uncertain create stays quarantined across reloads. A new server session is the only
  // positive recovery evidence; an empty GET cannot prove a delayed POST was rejected.
  useEffect(() => {
    try {
      const previous = localStorage.getItem(storageKey);
      if (previous !== null && state?.session && state.session.id !== previous) {
        localStorage.removeItem(storageKey);
        setAmbiguous(false);
      } else setAmbiguous(previous !== null);
    } catch {
      setAmbiguous(true);
      setError('Browser recovery storage unavailable / 브라우저 복구 저장소를 사용할 수 없습니다.');
    }
  }, [storageKey, state?.session?.id]);

  useEffect(() => {
    mounted.current = true;
    const stop = () => {
      const run = runRef.current;
      if (run) {
        run.cancelled = true;
        if (run.id) void endWorkspaceLiveCheck(projectId, run.id, { keepalive: true }).catch(() => {});
      }
      void roomRef.current?.disconnect();
    };
    window.addEventListener('pagehide', stop);
    return () => {
      mounted.current = false;
      stop();
      window.removeEventListener('pagehide', stop);
    };
  }, [projectId]);

  const refresh = () => {
    void recover().catch(() => {
      if (mounted.current) setError('Recovery unavailable; no new session was requested / 복구 조회 실패: 새 세션을 요청하지 않았습니다.');
    });
  };

  const stop = () => {
    if (runRef.current) runRef.current.cancelled = true;
    const id = runRef.current?.id ?? state?.session?.id;
    if (!id) { refresh(); return; }
    setPhase('stopping');
    void endWorkspaceLiveCheck(projectId, id).then(() => recover()).catch(() => {
      if (mounted.current) setError('Stop not confirmed. Recover status; server expiry still applies / 종료 미확인: 상태를 조회하세요. 서버 만료 제한은 유지됩니다.');
    }).finally(() => {
      if (mounted.current && !runRef.current) setPhase('finished');
    });
  };

  const enableAudio = () => {
    const room = roomRef.current;
    if (!room) return;
    void room.startAudio().then(() => audioRef.current?.play()).then(() => {
      if (mounted.current) setPlaybackBlocked(false);
    }).catch(() => {
      if (mounted.current) setPlaybackBlocked(true);
    });
  };

  const start = () => {
    if (!consent || busy || runRef.current || ambiguous || query.isError || !state?.cleanupConfirmed || !state.limits.creationAllowed) return;
    // Freeze the identity and project for this routine, including its finally cleanup.
    const run = { cancelled: false, id: null as string | null };
    runRef.current = run;
    setBusy(true); setConsent(false); setPhase('creating'); setError(null);
    setVideoFrames(0); setAudioBytes(0); setAudioEnergy(0); setSampleCompleted(false); setHeard(false); setPlaybackBlocked(false);
    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    const tracks: RemoteTrack[] = [];
    let audioTrack: RemoteTrack | undefined;
    let frameHandle: number | undefined;
    let frames = 0;
    const decodedFrameBaseline = videoRef.current?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    let measureAudio = false;
    let baseline: { bytes: number; energy: number } | undefined;
    let timedOut = false;
    const deadline = Date.now() + 105_000;
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      run.cancelled = true;
      if (run.id) void endWorkspaceLiveCheck(projectId, run.id, { keepalive: true }).catch(() => {});
      void room.disconnect().catch(() => {});
    }, 105_000);
    const cancelled = () => run.cancelled || Date.now() >= deadline;
    const update = (fn: () => void) => { if (mounted.current) fn(); };
    // Called in the start gesture, before any paid request.
    void room.startAudio().catch(() => update(() => setPlaybackBlocked(true)));
    const onFrame = () => {
      frames += 1;
      update(() => setVideoFrames(frames));
      if (!run.cancelled && videoRef.current) frameHandle = videoRef.current.requestVideoFrameCallback(onFrame);
    };
    room.on(RoomEvent.TrackSubscribed, track => {
      tracks.push(track);
      if (run.cancelled) return;
      if (track.kind === Track.Kind.Video && videoRef.current) {
        const video = videoRef.current;
        track.attach(video);
        void video.play().catch(() => {});
        if ('requestVideoFrameCallback' in video) frameHandle = video.requestVideoFrameCallback(onFrame);
      }
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        audioTrack = track;
        track.attach(audioRef.current);
        void audioRef.current.play().catch(() => update(() => setPlaybackBlocked(true)));
      }
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => update(() => setPlaybackBlocked(!room.canPlaybackAudio)));
    void (async () => {
      let markerWritten = false;
      try {
        // Persist before submission so a reload cannot silently offer a replacement.
        localStorage.setItem(storageKey, state.session?.id ?? '');
        markerWritten = true;
        update(() => setAmbiguous(true));
        let current: WorkspaceLiveCheck;
        try {
          current = await startWorkspaceLiveCheck(projectId, { costConfirmed: true, maxSeconds: 120 }, { signal: AbortSignal.timeout(20_000) });
        } catch (e) {
          const status = (e as { status?: number })?.status;
          if (status && status >= 400 && status < 500 && status !== 408) {
            localStorage.removeItem(storageKey);
            markerWritten = false;
            update(() => setAmbiguous(false));
          }
          throw e;
        }
        run.id = current.session?.id ?? null;
        if (!run.id) throw new Error('No session');
        localStorage.removeItem(storageKey);
        markerWritten = false;
        update(() => { setAmbiguous(false); qc.setQueryData(key, current); setPhase('waiting'); });
        while (!cancelled()) {
          const session = current.session;
          if (!session || session.id !== run.id || session.status !== 'active' || session.stopRequested) throw new Error('Session stopped');
          if (session.rendererState === 'running') break;
          await pause(2500);
          current = await recover();
        }
        if (cancelled()) return;
        update(() => setPhase('connecting'));
        const connection = await getWorkspaceLiveConnection(projectId, run.id, { signal: AbortSignal.timeout(8000) });
        if (cancelled()) return;
        await room.connect(connection.url, connection.token, { autoSubscribe: true });
        if (cancelled()) return;
        update(() => setPhase('observing'));
        measureAudio = true;
        // Only count inbound audio after the sample request, not startup/background packets.
        const sample = sendWorkspaceLiveSample(projectId, run.id, { signal: AbortSignal.timeout(22_000) });
        const observeUntil = Math.min(deadline, Date.now() + 16_000);
        let sampleFailure = false;
        const sampleDone = sample.then(() => update(() => setSampleCompleted(true)), () => { sampleFailure = true; });
        while (!cancelled() && Date.now() < observeUntil) {
          if (measureAudio && audioTrack) {
            const stats = await audioTrack.getRTCStatsReport();
            stats?.forEach(report => {
              if (report.type !== 'inbound-rtp' || (report.kind ?? report.mediaType) !== 'audio') return;
              const bytes = Number(report.bytesReceived ?? 0);
              const energy = Number(report.totalAudioEnergy ?? 0);
              if (!baseline) baseline = { bytes, energy };
              update(() => { setAudioBytes(Math.max(0, bytes - baseline!.bytes)); setAudioEnergy(Math.max(0, energy - baseline!.energy)); });
            });
          }
          if (videoRef.current && !('requestVideoFrameCallback' in videoRef.current)) {
            const decoded = (videoRef.current as HTMLVideoElement).getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
            update(() => setVideoFrames(Math.max(0, decoded - decodedFrameBaseline)));
          }
          await pause(350);
        }
        await sampleDone;
        if (sampleFailure) throw new Error('Sample outcome unknown');
      } catch {
        update(() => setError('Diagnostic incomplete or request outcome unknown. No automatic retry. Recover status and confirm cleanup / 진단 미완료 또는 요청 결과 미확인. 자동 재시도하지 않습니다. 상태 조회와 정리 확인이 필요합니다.'));
      } finally {
        timedOut = timedOut || Date.now() >= deadline;
        clearTimeout(deadlineTimer);
        run.cancelled = true;
        if (frameHandle !== undefined && videoRef.current) videoRef.current.cancelVideoFrameCallback(frameHandle);
        tracks.forEach(track => { try { track.detach(); } catch { /* Continue server cleanup. */ } });
        // Browser teardown failures must never bypass the durable server stop.
        void room.disconnect().catch(() => {});
        if (roomRef.current === room) roomRef.current = null;
        update(() => setPhase('stopping'));
        try {
          // Recover a lost creation response before requesting stop. Never submit another create.
          if (!run.id && markerWritten) {
            const found = await recover();
            if (found.session && found.session.id !== (state.session?.id ?? '')) {
              run.id = found.session.id;
              localStorage.removeItem(storageKey);
              update(() => setAmbiguous(false));
            }
          }
          if (run.id) {
            await endWorkspaceLiveCheck(projectId, run.id, { signal: AbortSignal.timeout(8000) });
            // Poll only reads; a stop acknowledgment is not cleanup evidence.
            for (let i = 0; i < 8 && mounted.current; i++) {
              const result = await recover();
              if (result.cleanupConfirmed) break;
              await pause(2500);
            }
          }
        } catch {
          update(() => setError('Cleanup not confirmed; new starts remain blocked. Recover status or contact an operator / 정리 미확인: 새 시작이 차단됩니다. 상태를 조회하거나 운영자에게 확인하세요.'));
        }
        runRef.current = null;
        update(() => {
          setBusy(false); setPhase('finished');
          if (timedOut) setError('Diagnostic time limit reached. Cleanup requested; verify confirmation / 진단 시간 제한 도달. 종료를 요청했으며 정리 확인이 필요합니다.');
          void qc.invalidateQueries({ queryKey: getGetDeveloperWorkspaceQueryKey(projectId) });
        });
      }
    })();
  };

  return {
    state, loading: query.isLoading, busy, consent, setConsent,
    canStart: !!user && consent && !busy && !ambiguous && !query.isError && !!state?.cleanupConfirmed && !!state.limits.creationAllowed,
    phase, error: error ?? (query.isError ? 'Status unavailable; paid start blocked / 상태 조회 실패: 유료 시작 차단' : ambiguous ? 'Creation outcome unknown; recover status, never resubmit / 생성 결과 미확인: 상태를 조회하세요. 다시 생성하지 마세요.' : null),
    videoFrames, audioBytes, audioEnergy, sampleCompleted, playbackBlocked, heard, setHeard,
    videoRef, audioRef, start, stop, refresh, enableAudio,
  };
}
