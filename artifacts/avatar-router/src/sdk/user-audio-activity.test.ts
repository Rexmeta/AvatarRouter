import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUserAudioActivity, type UserAudioActivity } from './user-audio-activity';

test('ignores duplicate and stale utterance edges, plus callbacks after closing', () => {
  let active = true;
  const events: UserAudioActivity[] = [];
  const activity = createUserAudioActivity(() => active, event => events.push(event));
  activity.speechStarted('first');
  activity.speechStarted('first');
  activity.speechStarted('second');
  activity.speechEnded('first');
  activity.speechEnded('second');
  active = false;
  activity.speechStarted('third');
  activity.audioLevel(0.4);
  assert.deepEqual(events, [{ speaking: true }, { speaking: true }, { speaking: false }]);
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
