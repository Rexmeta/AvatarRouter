import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyEvidence, observe, canReport } from './live-validation-evidence';

const target = { uid: 'owner', assetId: 'asset', providerAvatarId: 'face', sid: 'validation' };
const session = { id: 'validation', avatarAssetId: 'asset', providerId: 'tavus', avatarId: 'face', purpose: 'validation', status: 'active' };
const sample = { readyState: 2, videoWidth: 100, currentTime: 1, muted: false, liveAudio: true };
test('a still image/connection/track is not decoded moving video', () => {
  const initial = observe(emptyEvidence(), sample);
  assert.equal(initial.video, false);
  assert.equal(observe(initial, sample).video, false);
  assert.equal(observe(initial, { ...sample, currentTime: 2, videoWidth: 0 }).video, false);
  assert.equal(observe(initial, { ...sample, currentTime: 2, readyState: 1 }).video, false);
  assert.equal(observe(initial, { ...sample, currentTime: 2 }).video, true);
});
test('muted, missing returned audio and missing administrator acknowledgement cannot report', () => {
  for (const s of [{ ...sample, muted: true }, { ...sample, liveAudio: false }]) {
    const ev = observe(observe(emptyEvidence(), s), { ...s, currentTime: 2 });
    assert.equal(canReport(target, session, ev, true, 'owner'), false);
  }
  const ev = observe(observe(emptyEvidence(), sample), { ...sample, currentTime: 2 });
  assert.equal(canReport(target, session, ev, false, 'owner'), false);
  assert.equal(canReport(target, session, ev, true, 'owner'), true);
});
test('stale session, account and asset results cannot be reported for current target', () => {
  const ev = { video: true, audio: true, lastTime: 2 };
  for (const s of [
    { ...session, id: 'old' }, { ...session, avatarAssetId: 'other' }, { ...session, avatarId: 'other' },
    { ...session, providerId: 'anam' }, { ...session, purpose: 'conversation' }, { ...session, status: 'ended' },
  ]) assert.equal(canReport(target, s, ev, true, 'owner'), false);
  assert.equal(canReport(target, session, ev, true, 'other-owner'), false);
  assert.equal(canReport(target, session, emptyEvidence(), true, 'owner'), false);
});
