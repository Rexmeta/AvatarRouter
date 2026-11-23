function createAnalysisContext() {
  // Browsers that support a silent sink can analyse without opening an output
  // device. Others ignore the option; the analyser still has no playback path.
  const options: AudioContextOptions & { sinkId: { type: 'none' } } = { sinkId: { type: 'none' } };
  try { return new AudioContext(options); }
  catch { return new AudioContext(); }
}

/** Observe a microphone the native client already owns. The meter never
 * captures, plays, records, transmits, or stops the client's media. */
export function createLocalMicrophoneMeter(
  active: () => boolean,
  onLevel: (level: number) => void,
  createContext = createAnalysisContext,
) {
  let context: AudioContext | undefined;
  let closed = false;
  let current: { stream: MediaStream; track: MediaStreamTrack; detach(): void } | undefined;

  const detach = () => {
    const previous = current;
    current = undefined;
    previous?.detach();
  };
  const watch = (stream: MediaStream) => {
    if (closed || !active()) return;
    const track = stream.getAudioTracks()[0];
    if (current && current.stream === stream && current.track === track) return;
    detach();
    if (!track || track.readyState !== 'live') return;

    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    try {
      const audio = context ??= createContext();
      source = audio.createMediaStreamSource(stream);
      analyser = audio.createAnalyser();
      analyser.fftSize = 2048;
      // No connection to audio.destination: this graph must never play the microphone.
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const input = analyser;
      const onEnded = () => { if (current?.track === track) detach(); };
      const timer = setInterval(() => {
        if (closed || !active() || track.readyState !== 'live') { detach(); return; }
        if (!track.enabled || track.muted || audio.state !== 'running') { onLevel(0); return; }
        input.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        onLevel(Math.min(1, Math.sqrt(energy / samples.length)));
      }, 100);
      current = {
        stream, track,
        detach: () => {
          clearInterval(timer);
          track.removeEventListener('ended', onEnded);
          source?.disconnect();
          analyser?.disconnect();
        },
      };
      track.addEventListener('ended', onEnded, { once: true });
      if (audio.state === 'suspended') void audio.resume().catch(() => {});
    } catch {
      // A browser without a usable analyser still keeps the native call running.
      if (current) detach();
      else { source?.disconnect(); analyser?.disconnect(); }
    }
  };

  return {
    watch,
    stop() {
      if (closed) return;
      closed = true;
      try { detach(); }
      finally {
        if (context && context.state !== 'closed') void context.close().catch(() => {});
      }
    },
  };
}
