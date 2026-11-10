import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRoleplayDraft, prepareRoleplay, roleplayFields } from './anam-roleplay-input';

test('disabled roleplay omits context even when a draft remains', () => {
  assert.deepEqual(prepareRoleplay(false, { persona: 'private', scenario: 'private', language: '', greeting: '' }), {});
});

test('required roleplay text cannot be blank; optional blanks are omitted', () => {
  assert.equal(prepareRoleplay(true, emptyRoleplayDraft()).invalid, 'persona');
  assert.equal(prepareRoleplay(true, { ...emptyRoleplayDraft(), persona: 'buyer' }).invalid, 'scenario');
  assert.deepEqual(prepareRoleplay(true, { persona: ' buyer ', scenario: ' meeting ', language: ' ', greeting: '' }),
    { roleplay: { persona: 'buyer', scenario: 'meeting' } });
});

test('each field enforces its API minimum and maximum', () => {
  for (const field of roleplayFields) {
    const valid = { persona: 'buyer', scenario: 'meeting', language: '', greeting: '' };
    assert.equal(prepareRoleplay(true, { ...valid, [field.key]: 'x'.repeat(field.max) }).invalid, undefined);
    assert.equal(prepareRoleplay(true, { ...valid, [field.key]: 'x'.repeat(field.max + 1) }).invalid, field.key);
  }
  assert.equal(prepareRoleplay(true, { persona: 'buyer', scenario: 'meeting', language: 'K', greeting: '' }).invalid, 'language');
});

test('request context is a snapshot unaffected by edits during conversation', () => {
  const draft = { persona: 'buyer', scenario: 'first meeting', language: 'Korean', greeting: 'Hello' };
  const request = prepareRoleplay(true, draft);
  draft.scenario = 'later meeting';
  assert.equal(request.roleplay?.scenario, 'first meeting');
  assert.equal(prepareRoleplay(true, draft).roleplay?.scenario, 'later meeting');
  assert.deepEqual(emptyRoleplayDraft(), { persona: '', scenario: '', language: '', greeting: '' });
});
