import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalMicrophoneMeter } from './local-microphone-meter';

class ExistingTrack extends EventTarget {
  readyState = 'live';
  enabled = true;
  muted = false;
  stop() { assert.fail('The meter must never stop the shared track'); }
}

function nativeStream(track = new ExistingTrack()) {
  return { track, stream: { getAudioTracks: () => [track] } as unknown as MediaStream };
}

function fakeAudioContext() {
  const streams: MediaStream[] = [];
  const links: unknown[] = [];
  let disconnected = 0, closed = 0, reads = 0;
  let amplitude = 0.25;
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData(samples: Float32Array) { reads++; samples.fill(amplitude); },
    connect() { assert.fail('The meter must never route input to playback'); },
    disconnect() {},
  };
  const audio = {
    state: 'running',
    createMediaStreamSource(stream: MediaStream) {
      streams.push(stream);
      return {
        connect(node: unknown) { assert.equal(node, analyser); links.push(node); },
        disconnect() { disconnected++; },
      };
    },
    createAnalyser() { return analyser; },
    async resume() { audio.state = 'running'; },
    async close() { closed++; audio.state = 'closed'; },
  };
  return {
    audio, streams, links,
    context: audio as unknown as AudioContext,
    setAmplitude(level: number) { amplitude = level; },
    calls: () => ({ disconnected, closed, reads }),
  };
}

test('measures only the existing native mic and does not read muted input or play it', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { stream, track } = nativeStream();
  const fake = fakeAudioContext();
  const levels: number[] = [];
  const meter = createLocalMicrophoneMeter(() => true, level => levels.push(level), () => fake.context);
  meter.watch(stream);
  meter.watch(stream);
  assert.deepEqual(fake.streams, [stream]);
  assert.equal(fake.links.length, 1);
  t.mock.timers.tick(100);
  track.muted = true;
  t.mock.timers.tick(100);
  track.muted = false;
  track.enabled = false;
  t.mock.timers.tick(100);
  track.enabled = true;
  fake.setAmplitude(0);
  t.mock.timers.tick(100);
  assert.deepEqual(levels, [0.25, 0, 0, 0]);
  assert.equal(fake.calls().reads, 2);
  meter.stop();
  meter.stop();
  t.mock.timers.tick(300);
  assert.deepEqual(fake.calls(), { disconnected: 1, closed: 1, reads: 2 });
  assert.equal(track.readyState, 'live');
});

test('rebinds to the replacement native track and ignores ended or stale streams', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const first = nativeStream(), second = nativeStream();
  const fake = fakeAudioContext();
  const levels: number[] = [];
  let active = true;
  const meter = createLocalMicrophoneMeter(() => active, level => levels.push(level), () => fake.context);
  meter.watch(first.stream);
  meter.watch(second.stream);
  first.track.dispatchEvent(new Event('ended'));
  t.mock.timers.tick(100);
  assert.deepEqual(levels, [0.25]);
  second.track.readyState = 'ended';
  second.track.dispatchEvent(new Event('ended'));
  t.mock.timers.tick(100);
  active = false;
  meter.watch(first.stream);
  assert.deepEqual(fake.streams, [first.stream, second.stream]);
  assert.equal(fake.calls().disconnected, 2);
  meter.stop();
  assert.deepEqual(levels, [0.25]);
});

test('missing Web Audio does not fail the native call', () => {
  const { stream } = nativeStream();
  const meter = createLocalMicrophoneMeter(() => true, () => assert.fail('Unexpected level'), () => {
    throw new Error('AudioContext unavailable');
  });
  assert.doesNotThrow(() => meter.watch(stream));
  assert.doesNotThrow(() => meter.stop());
});
