/** PCM framing shared by the offline spike and official-plugin worker. */
export interface PcmFrame {
  samples: Int16Array;
  sampleRate: 24000;
}

export class PcmFramer {
  private pending = Buffer.alloc(0);
  readonly frameBytes = 960; // 20 ms * 24 kHz * mono * 16-bit
  push(bytes: Uint8Array): PcmFrame[] {
    this.pending = Buffer.concat([this.pending, bytes]);
    const frames: PcmFrame[] = [];
    while (this.pending.length >= this.frameBytes) {
      frames.push(this.decode(this.pending.subarray(0, this.frameBytes)));
      this.pending = this.pending.subarray(this.frameBytes);
    }
    return frames;
  }
  finish(): PcmFrame[] {
    if (this.pending.length % 2 !== 0) throw new Error("Incomplete PCM16 sample at turn boundary");
    if (!this.pending.length) return [];
    const frame = this.decode(this.pending);
    this.pending = Buffer.alloc(0);
    return [frame];
  }
  clear(): void { this.pending = Buffer.alloc(0); }
  private decode(bytes: Buffer): PcmFrame {
    const samples = new Int16Array(bytes.length / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2);
    return { samples, sampleRate: 24000 };
  }
}

/** Deterministic test tone, explicitly NOT synthetic speech or a dialogue model. */
export function mockPcmSource(durationMs = 1000): Uint8Array {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 10_000) {
    throw new Error("Test tone duration must be an integer from 1 to 10000 ms");
  }
  const bytes = Buffer.alloc(Math.floor(durationMs * 24) * 2);
  for (let i = 0; i < bytes.length / 2; i++) {
    bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 24000) * 2000), i * 2);
  }
  return bytes;
}

export type AudioBridgeEvent =
  | { type: "audio"; turn: number; sequence: number; pcm: Uint8Array }
  | { type: "end"; turn: number }
  | { type: "interrupt"; turn: number };

/**
 * No transcript or scenario ownership here. A cancelled turn never resumes;
 * the caller must start a strictly newer turn. No silent sample-rate conversion.
 */
export class PcmBridge {
  private framer = new PcmFramer();
  private currentTurn = -1;
  private lastSequence = -1;
  private closed = false;
  constructor(private sink: {
    write(frame: PcmFrame): Promise<void>;
    flush(): void;
    clear(): void;
  }) {}
  async accept(event: AudioBridgeEvent): Promise<void> {
    if (!Number.isSafeInteger(event.turn) || event.turn < 0) throw new Error("Invalid turn");
    if (event.turn < this.currentTurn) return;
    if (event.turn > this.currentTurn) {
      this.framer.clear();
      this.currentTurn = event.turn; this.lastSequence = -1; this.closed = false;
    }
    if (event.type === "interrupt") {
      this.closed = true; this.framer.clear(); this.sink.clear(); return;
    }
    if (this.closed) return;
    if (event.type === "end") {
      for (const frame of this.framer.finish()) await this.sink.write(frame);
      this.sink.flush(); this.closed = true; return;
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) throw new Error("Invalid sequence");
    if (event.sequence <= this.lastSequence) return; // duplicate or stale packet
    if (event.sequence !== this.lastSequence + 1) throw new Error("PCM sequence gap; do not silently reorder audio");
    if (event.pcm.byteLength > 48_000) throw new Error("PCM chunk exceeds one second");
    this.lastSequence = event.sequence;
    for (const frame of this.framer.push(event.pcm)) await this.sink.write(frame);
  }
}
