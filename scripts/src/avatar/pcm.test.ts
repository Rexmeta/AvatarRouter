import { test } from "node:test";
import assert from "node:assert/strict";
import { PcmFramer, PcmBridge, mockPcmSource, type PcmFrame } from "./pcm";

test("synthetic source has exact PCM duration and explicit 20ms framing", () => {
  const data = mockPcmSource(1000);
  assert.equal(data.length, 48_000);
  const framer = new PcmFramer();
  const frames = framer.push(data);
  assert.equal(frames.length, 50);
  assert.equal(frames[0]!.samples.length, 480);
  assert.equal(frames[0]!.sampleRate, 24000);
  assert.deepEqual(framer.finish(), []);
});
test("odd byte boundaries are buffered, signed little endian preserved", () => {
  const framer = new PcmFramer();
  assert.equal(framer.push(Uint8Array.of(0xff)).length, 0);
  assert.equal(framer.push(Uint8Array.of(0x7f, 0, 0x80)).length, 0);
  assert.deepEqual([...framer.finish()[0]!.samples], [32767, -32768]);
});
test("incomplete samples fail explicitly; clearing discards partial frames", () => {
  const framer = new PcmFramer();
  framer.push(Uint8Array.of(1)); assert.throws(() => framer.finish(), /Incomplete/);
  framer.clear(); assert.deepEqual(framer.finish(), []);
});
test("mock source rejects unbounded durations", () => {
  assert.throws(() => mockPcmSource(0));
  assert.throws(() => mockPcmSource(10001));
});
test("bridge deduplicates and flushes partial turn at end", async () => {
  const frames: PcmFrame[] = []; let flushes = 0;
  const bridge = new PcmBridge({ write: async f => { frames.push(f); }, flush: () => { flushes++; }, clear() {} });
  const event = { type: "audio" as const, turn: 0, sequence: 0, pcm: mockPcmSource(25) };
  await bridge.accept(event); await bridge.accept(event);
  await bridge.accept({ type: "end", turn: 0 });
  assert.equal(frames.length, 2); assert.equal(flushes, 1);
});
test("interruption drops old turn and resumes only on newer turn", async () => {
  let writes = 0, clears = 0;
  const bridge = new PcmBridge({ write: async () => { writes++; }, flush() {}, clear() { clears++; } });
  await bridge.accept({ type: "audio", turn: 0, sequence: 0, pcm: mockPcmSource(20) });
  await bridge.accept({ type: "interrupt", turn: 0 });
  await bridge.accept({ type: "audio", turn: 0, sequence: 1, pcm: mockPcmSource(20) });
  await bridge.accept({ type: "audio", turn: 1, sequence: 0, pcm: mockPcmSource(20) });
  assert.equal(writes, 2); assert.equal(clears, 1);
});
test("out-of-order gaps are errors, never silent reordered audio", async () => {
  const bridge = new PcmBridge({ async write() {}, flush() {}, clear() {} });
  await assert.rejects(bridge.accept({ type: "audio", turn: 0, sequence: 3, pcm: mockPcmSource(20) }), /sequence gap/);
});
