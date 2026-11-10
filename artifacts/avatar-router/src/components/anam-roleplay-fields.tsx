import { roleplayFields, type RoleplayDraft } from '@/lib/anam-roleplay-input';

type Props = {
  enabled: boolean;
  draft: RoleplayDraft;
  onEnabled: (enabled: boolean) => void;
  onDraft: (draft: RoleplayDraft) => void;
  L: (en: string, ko: string) => string;
  providerName?: 'Anam' | 'Tavus';
  allowDefaultPersona?: boolean;
};

export function AnamRoleplayFields({ enabled, draft, onEnabled, onDraft, L, providerName = 'Anam', allowDefaultPersona = true }: Props) {
  return (
    <section className="space-y-3 rounded border p-3" aria-label={L('Roleplay test', '역할 테스트')}>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={enabled} disabled={!allowDefaultPersona} onChange={e => onEnabled(e.target.checked)}
          data-testid="checkbox-anam-roleplay" className="h-4 w-4 accent-[hsl(var(--primary))]" />
        {L('Test a persona and scenario', '페르소나·시나리오로 테스트')}
      </label>
      <p className="text-xs text-muted-foreground">
        {allowDefaultPersona ? L('Off: use the saved Anam persona. Changes apply only to the next new session, never the current conversation.',
          '끄면 기존 Anam 페르소나를 사용합니다. 편집 내용은 다음 새 세션에만 적용되며 진행 중인 대화는 바뀌지 않습니다.')
          : L('Context is required. Changes apply only to the next new session, never the current conversation.',
            '컨텍스트 입력이 필요합니다. 편집 내용은 다음 새 세션에만 적용되며 진행 중인 대화는 바뀌지 않습니다.')}
      </p>
      {enabled && (
        <div className="space-y-3" data-testid="anam-roleplay-fields">
          {roleplayFields.map(field => {
            const value = draft[field.key];
            const invalid = (field.required || !!value.trim()) && (value.trim().length < field.min || value.trim().length > field.max);
            const fieldId = `anam-roleplay-${field.key}`;
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={fieldId} className="block text-xs font-medium">
                  {L(field.en, field.ko)} · {field.required ? L('Required', '필수') : L('Optional', '선택')}
                </label>
                <textarea id={fieldId} data-testid={fieldId} value={value} rows={field.rows}
                  maxLength={field.max} required={field.required} aria-invalid={invalid}
                  aria-describedby={`${fieldId}-hint`}
                  onChange={e => onDraft({ ...draft, [field.key]: e.target.value })}
                  className="w-full resize-y rounded border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  autoComplete="off" spellCheck={false} />
                <p id={`${fieldId}-hint`} className="text-[11px] text-muted-foreground">
                  {value.length.toLocaleString()} / {field.max.toLocaleString()} · {L(`Minimum ${field.min} characters after trimming`, `앞뒤 공백 제외 최소 ${field.min}자`)}
                </p>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {L(`Drafts stay only in this page’s memory. Submitted context is sent to AvatarRouter and ${providerName}. Do not enter secrets or unnecessary personal data.`,
              `초안은 이 페이지 메모리에만 유지됩니다. 시작하면 컨텍스트가 AvatarRouter와 ${providerName}에 전달됩니다. 비밀이나 불필요한 개인정보를 입력하지 마세요.`)}
          </p>
          <button type="button" onClick={() => onDraft({ persona: '', scenario: '', language: '', greeting: '' })}
            className="rounded border px-2 py-1 text-xs hover:bg-muted" data-testid="button-anam-roleplay-clear">
            {L('Clear draft', '입력 지우기')}
          </button>
        </div>
      )}
    </section>
  );
}
