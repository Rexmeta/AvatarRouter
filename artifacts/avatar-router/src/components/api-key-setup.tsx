import { CopyBlock } from '@/components/bits';
import { useI18n } from '@/lib/i18n';

export const SCOPES = [
  'live-limits:read', 'sessions:create', 'sessions:read', 'sessions:connect',
  'sessions:audio', 'sessions:interrupt', 'sessions:end', 'assets:read', 'assets:write',
] as const;
export const DEFAULT_SCOPES: string[] = SCOPES.slice(0, 7);

export function apiBaseUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/api/v1`;
}

/** Copyable connection setup. `secret` is only passed for a freshly issued key and never stored. */
export function ConnectionSetup({ secret }: { secret?: string }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const base = apiBaseUrl();
  const key = secret ?? '<paste the one-time secret here>';
  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-md border bg-border text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="eyebrow bg-muted px-3 py-2">AVATAR_ROUTER_BASE_URL</div>
        <div className="mono break-all bg-card px-3 py-2 text-[12.5px]" data-testid="text-base-url">{base}</div>
        <div className="eyebrow bg-muted px-3 py-2">AVATAR_ROUTER_API_KEY</div>
        <div className="mono bg-card px-3 py-2 text-[12.5px] text-muted-foreground">{secret ? (en ? 'included below — copy it now' : '아래 포함됨 — 지금 복사하세요') : (en ? 'shown once when a key is created or rotated' : '키 생성/교체 시 한 번만 표시')}</div>
      </div>
      <CopyBlock label=".env (server only)" code={`AVATAR_ROUTER_BASE_URL=${base}\nAVATAR_ROUTER_API_KEY=${key}`} />
      <CopyBlock label={en ? 'verify key — free, no session' : '키 확인 — 무료, 세션 없음'} code={`curl -sS "$AVATAR_ROUTER_BASE_URL/auth/check" \\\n  -H "Authorization: Bearer $AVATAR_ROUTER_API_KEY"`} />
      <CopyBlock label={en ? 'optional: partition by your verified user' : '선택: 검증된 사용자별 분리'} code={`curl -sS "$AVATAR_ROUTER_BASE_URL/sessions" \\\n  -H "Authorization: Bearer $AVATAR_ROUTER_API_KEY" \\\n  -H "X-Avatar-User-ID: <id from your server-verified login>"`} />
    </div>
  );
}

export function KeyFacts() {
  const { lang } = useI18n();
  const items = lang === 'en' ? [
    'A key authenticates a project, not a person. Keep it on your server; never ship it to a browser.',
    'X-Avatar-User-ID is optional. Set it only from your own server-verified login to partition sessions inside the project.',
    'One project per external tenant. Do not share a key across customers.',
    'No issuer, JWKS or login migration is required. Your users keep signing in where they do today.',
    'Not OpenAI chat/completions compatible. AvatarRouter renders avatars; your dialogue stays yours.',
    'Live create returns rendererState queued. Poll until running; paid sessions need costConfirmed and explicit cleanup.',
    'Gemini-to-avatar streaming is not proven yet. The audio endpoint is a bounded PCM test.',
  ] : [
    '키는 사람이 아닌 프로젝트를 인증합니다. 서버에만 보관하고 브라우저로 보내지 마세요.',
    'X-Avatar-User-ID는 선택입니다. 서버에서 검증된 로그인에서만 설정해 프로젝트 내 세션을 분리하세요.',
    '외부 테넌트마다 별도 프로젝트 키를 사용하세요.',
    '이슈어, JWKS, 로그인 이전이 필요 없습니다.',
    'OpenAI chat/completions 호환이 아닙니다. 대화 로직은 그대로 유지됩니다.',
    '라이브 생성은 queued를 반환합니다. running까지 폴링하세요. 유료 세션은 costConfirmed와 명시적 정리가 필요합니다.',
    'Gemini-아바타 스트리밍은 아직 검증되지 않았습니다. 오디오 엔드포인트는 제한된 PCM 테스트입니다.',
  ];
  return (
    <ul className="space-y-2.5 p-4 text-[13px] leading-snug">
      {items.map((s) => <li key={s} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{s}</li>)}
    </ul>
  );
}
