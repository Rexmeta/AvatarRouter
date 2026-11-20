import type { WorkspaceStockVoice } from '@workspace/api-client-react';

export const STOCK_VOICE_GENDERS = ['male', 'female', 'neutral', 'unclassified'] as const satisfies readonly WorkspaceStockVoice['gender'][];

export type StockVoiceFilters = {
  name: string;
  gender: 'all' | WorkspaceStockVoice['gender'];
  // Prefix provider values so they cannot collide with either special option.
  language: 'all' | 'unknown' | `language:${string}`;
};

export const DEFAULT_STOCK_VOICE_FILTERS: StockVoiceFilters = {
  name: '',
  gender: 'all',
  language: 'all',
};

export function stockVoiceLanguages(voices: readonly WorkspaceStockVoice[], locale: string) {
  return [...new Set(voices.flatMap(voice => voice.languages))].sort((a, b) => a.localeCompare(b, locale));
}

export function filterStockVoices(voices: readonly WorkspaceStockVoice[], filters: StockVoiceFilters) {
  const name = filters.name.trim().normalize().toLowerCase();
  const { gender, language } = filters;
  return voices.filter(voice =>
    (!name || voice.name.normalize().toLowerCase().includes(name)) &&
    (gender === 'all' || voice.gender === gender) &&
    (language === 'all' || (language === 'unknown'
      ? voice.languages.length === 0
      : voice.languages.some(value => `language:${value}` === language))),
  );
}
