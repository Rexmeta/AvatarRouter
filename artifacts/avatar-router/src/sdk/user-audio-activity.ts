export type UserAudioActivity = { level: number };

/** UI-only levels from the existing native microphone. */
export function createUserAudioActivity(active: () => boolean, onActivity?: (activity: UserAudioActivity) => void) {
  return {
    audioLevel(level: number) {
      if (!active() || !Number.isFinite(level) || level < 0 || level > 1) return;
      try { onActivity?.({ level }); } catch { /* host UI must not affect media */ }
    },
  };
}
