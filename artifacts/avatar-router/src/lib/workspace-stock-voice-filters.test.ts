import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceStockVoice } from '@workspace/api-client-react';
import { DEFAULT_STOCK_VOICE_FILTERS, filterStockVoices, stockVoiceLanguages, type StockVoiceFilters } from './workspace-stock-voice-filters';

function voice(id: string, fields: Partial<WorkspaceStockVoice> = {}): WorkspaceStockVoice {
  return { id, name: id, gender: 'unclassified', genderSource: 'unknown', languages: [], selection: 'browse_only', ...fields };
}

function search(voices: WorkspaceStockVoice[], filters: Partial<StockVoiceFilters>) {
  return filterStockVoices(voices, { ...DEFAULT_STOCK_VOICE_FILTERS, ...filters }).map(voice => voice.id);
}

test('name search ignores case and surrounding whitespace and reaches beyond the first 30 voices', () => {
  const voices = [
    ...Array.from({ length: 31 }, (_, i) => voice(`voice-${i}`)),
    voice('voice-31', { name: 'Élodie 서울' }),
    voice('élodie-in-id-only', { name: 'Another name' }),
  ];
  assert.deepEqual(search(voices, { name: ' E\u0301LODIE ' }), ['voice-31']);
  assert.deepEqual(search(voices, { name: '서울' }), ['voice-31']);
  assert.deepEqual(search(voices, { name: '  ' }), voices.map(voice => voice.id));
});

test('name, reported gender and exact language combine without guessing missing values', () => {
  const voices = [
    voice('verified', { name: 'Kim Studio', gender: 'female', genderSource: 'admin', languages: ['ko-KR', 'en'] }),
    voice('other-region', { name: 'Kim Studio', gender: 'female', genderSource: 'provider', languages: ['ko'] }),
    voice('classified-neutral', { name: 'Kim Studio', gender: 'neutral', genderSource: 'provider', languages: ['ko-KR'] }),
    voice('missing-gender', { name: 'Kim Female Korean', languages: ['ko-KR'] }),
    voice('missing-language', { name: 'Kim Studio Korean', gender: 'female', genderSource: 'provider' }),
    voice('missing-both', { name: 'Kim Female Seoul' }),
  ];
  assert.deepEqual(search(voices, { name: 'kim', gender: 'female', language: 'language:ko-KR' }), ['verified']);
  assert.deepEqual(search(voices, { gender: 'neutral' }), ['classified-neutral']);
  assert.deepEqual(search(voices, { gender: 'unclassified' }), ['missing-gender', 'missing-both']);
  assert.deepEqual(search(voices, { language: 'unknown' }), ['missing-language', 'missing-both']);
  assert.deepEqual(search(voices, { gender: 'unclassified', language: 'unknown' }), ['missing-both']);
  assert.deepEqual(search(voices, { name: 'nonexistent' }), []);
});

test('language options come from the full loaded list and cannot collide with special filters', () => {
  const voices = [
    voice('first', { languages: ['ko', 'en'] }),
    voice('second', { languages: ['en', 'all', 'unknown'] }),
    voice('third'),
  ];
  assert.deepEqual(stockVoiceLanguages(voices, 'en'), ['all', 'en', 'ko', 'unknown']);
  assert.deepEqual(search(voices, { language: 'language:en' }), ['first', 'second']);
  assert.deepEqual(search(voices, { language: 'language:unknown' }), ['second']);
  assert.deepEqual(search(voices, { language: 'language:all' }), ['second']);
  assert.deepEqual(search(voices, { language: 'unknown' }), ['third']);
});
