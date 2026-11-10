import type { RoleplayContext } from '@workspace/api-client-react';

export const roleplayFields = [
  { key: 'persona', min: 1, max: 8000, required: true, en: 'Persona traits', ko: '페르소나 특성', rows: 3 },
  { key: 'scenario', min: 1, max: 16000, required: true, en: 'Scenario context', ko: '시나리오 컨텍스트', rows: 4 },
  { key: 'language', min: 2, max: 80, required: false, en: 'Spoken language', ko: '발화 언어', rows: 1 },
  { key: 'greeting', min: 1, max: 1000, required: false, en: 'Opening line', ko: '첫 인사말', rows: 2 },
] as const;

export type RoleplayDraft = Record<(typeof roleplayFields)[number]['key'], string>;
export const emptyRoleplayDraft = (): RoleplayDraft => ({ persona: '', scenario: '', language: '', greeting: '' });

/** Return a fresh snapshot, never the editable draft. Disabled mode sends no context. */
export function prepareRoleplay(enabled: boolean, draft: RoleplayDraft):
  { roleplay?: RoleplayContext; invalid?: keyof RoleplayDraft } {
  if (!enabled) return {};
  const values = {} as RoleplayDraft;
  for (const field of roleplayFields) {
    const value = draft[field.key].trim();
    if (!field.required && !value) continue;
    if (value.length < field.min || value.length > field.max) return { invalid: field.key };
    values[field.key] = value;
  }
  return { roleplay: { ...values } };
}
