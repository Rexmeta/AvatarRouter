import type { RefObject } from 'react';
import type { WorkspaceLiveCheck } from '@workspace/api-client-react';

export interface LiveCheckView {
  state: WorkspaceLiveCheck | undefined;
  loading: boolean;
  busy: boolean;
  consent: boolean;
  setConsent: (value: boolean) => void;
  canStart: boolean;
  phase: 'idle' | 'creating' | 'waiting' | 'connecting' | 'observing' | 'stopping' | 'finished';
  error: string | null;
  videoFrames: number;
  audioBytes: number;
  audioEnergy: number;
  sampleCompleted: boolean;
  playbackBlocked: boolean;
  heard: boolean;
  setHeard: (value: boolean) => void;
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
  start: () => void;
  stop: () => void;
  refresh: () => void;
  enableAudio: () => void;
}
