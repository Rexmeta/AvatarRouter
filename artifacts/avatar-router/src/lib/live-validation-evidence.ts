export type VideoSample = { readyState: number; videoWidth: number; currentTime: number; muted: boolean; liveAudio: boolean };
export type Evidence = { video: boolean; audio: boolean; lastTime: number | null };

export const emptyEvidence = (): Evidence => ({ video: false, audio: false, lastTime: null });

/** Pure fold: video only counts when frames are decoded, sized, and time has actually advanced. */
export function observe(prev: Evidence, s: VideoSample): Evidence {
  const decodable = s.readyState >= 2 && s.videoWidth > 0;
  const advanced = decodable && prev.lastTime !== null && s.currentTime > prev.lastTime;
  return {
    video: prev.video || advanced,
    audio: prev.audio || (decodable && !s.muted && s.liveAudio),
    lastTime: decodable ? s.currentTime : prev.lastTime,
  };
}

export type ReportTarget = { uid: string | null; assetId: string; providerAvatarId: string | null; sid: string };
export type SessionLike = { id: string; providerId: string; avatarId: string; avatarAssetId?: string | null; purpose?: string; status: string } | undefined;

/** Exact match of current account, asset, provider avatar and active validation session. */
export function canReport(t: ReportTarget, s: SessionLike, ev: Evidence, heard: boolean, currentUid: string | null): boolean {
  return !!t.uid && t.uid === currentUid && !!t.sid && !!s && s.id === t.sid && s.providerId === 'tavus'
    && s.avatarAssetId === t.assetId && !!t.providerAvatarId && s.avatarId === t.providerAvatarId
    && s.purpose === 'validation' && s.status === 'active' && ev.video && ev.audio && heard;
}
