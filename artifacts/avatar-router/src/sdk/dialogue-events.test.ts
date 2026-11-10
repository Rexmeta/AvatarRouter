import test from 'node:test';
import assert from 'node:assert/strict';
import { tavusUtterance } from './dialogue-events';

test('Tavus native utterances use the same dialogue shape and deduplicate legacy PAL events', () => {
  const event = { message_type: 'conversation', event_type: 'conversation.utterance', inference_id: 'one-turn',
    properties: { role: 'pal', speech: '한국어 대화' } };
  assert.deepEqual(tavusUtterance(event), { id: 'one-turn:assistant', role: 'assistant', text: '한국어 대화' });
  assert.deepEqual(tavusUtterance(event), tavusUtterance({ ...event, properties: { ...event.properties, role: 'replica' } }));
  assert.equal(tavusUtterance({ ...event, properties: { ...event.properties, role: 'user' } })?.role, 'user');
  for (const invalid of [null, {}, { ...event, inference_id: null }, { ...event, event_type: 'tool_call' },
    { ...event, properties: { role: 'system', speech: 'private' } },
    { ...event, properties: { role: 'pal', speech: '' } },
    { ...event, properties: { role: 'pal', speech: 'x'.repeat(10001) } }]) {
    assert.equal(tavusUtterance(invalid), null);
  }
});
