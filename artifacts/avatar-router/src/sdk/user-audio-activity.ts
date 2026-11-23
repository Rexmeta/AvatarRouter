export type UserAudioActivity = { speaking: boolean } | { level: number };

/** UI-only events from the existing native microphone or speech detector. */
export function createUserAudioActivity(active: () => boolean, onActivity?: (activity: UserAudioActivity) => void) {
  let currentSpeechId: string | undefined;
  const send = (activity: UserAudioActivity) => {
    if (!active()) return;
    try { onActivity?.(activity); } catch { /* host UI must not affect media */ }
  };
  return {
    speechStarted(id: string) {
      if (!id || id === currentSpeechId) return;
      currentSpeechId = id;
      send({ speaking: true });
    },
    speechEnded(id: string) {
      if (!id || id !== currentSpeechId) return;
      currentSpeechId = undefined;
      send({ speaking: false });
    },
    audioLevel(level: number) {
      if (Number.isFinite(level) && level >= 0 && level <= 1) send({ level });
    },
  };
}
