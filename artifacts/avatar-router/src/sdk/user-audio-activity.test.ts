import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUserAudioActivity, type UserAudioActivity } from './user-audio-activity';

test('does not deliver browser microphone callbacks after closing', () => {
  let active = true;
  const events: UserAudioActivity[] = [];
  const activity = createUserAudioActivity(() => active, event => events.push(event));
  activity.audioLevel(0.3);
  active = false;
  activity.audioLevel(0.4);
  assert.deepEqual(events, [{ level: 0.3 }]);
});

test('emits only finite normalized local audio levels and isolates host render errors', () => {
  const events: UserAudioActivity[] = [];
  const activity = createUserAudioActivity(() => true, event => {
    events.push(event);
    throw new Error('Host callback failed');
  });
  for (const level of [0, 0.4, 1, -0.1, 1.1, NaN, Infinity]) {
    assert.doesNotThrow(() => activity.audioLevel(level));
  }
  assert.deepEqual(events, [{ level: 0 }, { level: 0.4 }, { level: 1 }]);
});
