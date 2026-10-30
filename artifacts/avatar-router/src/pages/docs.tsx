import { useGetSetup } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { Link } from 'wouter';
import { CopyBlock, PageHead, Panel, Pill } from '@/components/bits';
import { ConnectionSetup, KeyFacts } from '@/components/api-key-setup';

const origin = typeof window !== 'undefined' ? window.location.origin : '';
const integrationDocsBase = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/roleplayx`;

const matrix = [
  ['Anam', 'Yes', 'Yes', 'Node', 'DataStreamAudioOutput; requires persona avatar ID', 'No credentials; pending'],
  ['Tavus', 'Yes', 'Yes', 'Node', '24 kHz output, echo transport; inspect package options', 'No credentials; pending'],
  ['LemonSlice', 'Yes', 'Yes', 'Node, later', 'Reuse official plugin; no invented metadata', 'Adapter pending'],
  ['Simli', 'Not listed', 'Yes', 'Python, later', '16 kHz DataStreamAudioOutput', 'Adapter pending'],
];

const milestones = [
  'Independent Studio, mock lifecycle, private image assets, and stock Tavus RTC. Image-derived live validation remains pending.',
  'Authenticated tenant-aware core, persistent metering, SDK/React packages.',
  'LemonSlice and Python Simli adapters with independent validation.',
  'Project API-key integration by default; optional JWT delegation and real-time audio verification.',
  'Complete Studio and secure managed administration.',
  'Operational hardening, load/browser/security validation and release approval.',
];

export default function Docs() {
  const { t } = useI18n();
  const setup = useGetSetup();
  return (
    <div>
      <PageHead index="06 / docs" title={t('docs.title')} lede="Start with a project API key. Advanced JWT delegation, the live API contract and current limitations follow." />

      {setup.data && (
        <div className="rise mb-8 flex flex-wrap gap-4 rounded-md border bg-card p-4 text-sm">
          <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2 [&>span:last-child]:max-w-full [&>span:last-child]:whitespace-normal [&>span:last-child]:break-words"><span className="eyebrow">{t('stage')}</span><Pill value={setup.data.stage} /></span>
          <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2 [&>span:last-child]:max-w-full [&>span:last-child]:whitespace-normal [&>span:last-child]:break-words"><span className="eyebrow">RoleplayX</span><Pill value={setup.data.roleplayxStatus} /></span>
          <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2 [&>span:last-child]:max-w-full [&>span:last-child]:whitespace-normal [&>span:last-child]:break-words"><span className="eyebrow">{t('bridge')}</span><Pill value={setup.data.bridgeStatus} /></span>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="min-w-0 space-y-10">
          <section className="rise rounded-md border-2 border-primary/60 bg-card p-5" data-testid="section-api-key-setup">
            <div className="eyebrow mb-1 text-primary">Recommended</div>
            <h2 className="mb-2 text-xl font-bold">Quick start: project API key</h2>
            <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">Create a key in <Link href="/api-keys" className="font-semibold text-foreground underline underline-offset-2" data-testid="link-docs-api-keys">API keys</Link>, store it on your server, and send it as <span className="mono">Authorization: Bearer</span>. No issuer, JWKS or login migration is required. The auth check below is free and starts no session.</p>
            <ConnectionSetup />
            <div className="mt-4 rounded border bg-muted/40"><KeyFacts /></div>
          </section>

          <section className="rise rounded-md border bg-card p-5">
            <div className="eyebrow mb-1">Advanced · optional</div>
            <h2 className="mb-2 text-xl font-bold">RoleplayX integration kit and JWT delegation</h2>
            <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              The provided Tavus stock avatar has been verified in a real LiveKit browser session. The machine-readable OpenAPI specification and upload-ready integration guide describe the current endpoints and state the identity and audio-bridge requirements.
            </p>
            <div className="mb-4 flex flex-wrap gap-3">
              <a className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted" href={`${integrationDocsBase}/openapi.yaml`} download="avatarrouter-openapi.yaml">Download OpenAPI YAML</a>
              <a className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted" href={`${integrationDocsBase}/integration-guide.md`} download="roleplayx-avatarrouter-integration-guide.md">Download integration guide</a>
              <a className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted" href={`${integrationDocsBase}/identity-contract.md`} download="roleplayx-identity-contract.md">Download identity contract</a>
              <a className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted" href={`${integrationDocsBase}/persona-live-integration.md`} download="persona-live-integration.md">Persona live integration · API 0.5</a>
              <a className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted" href={`${integrationDocsBase}/roleplaybot-live-diagnostics.md`} download="roleplaybot-live-diagnostics.md">RoleplayBot Live 연결 진단</a>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              <b className="text-foreground">Identity bridge:</b> RoleplayX keeps its existing login. Its backend issues a user-and-tenant-bound RS256 delegation JWT valid for at most 60 seconds. AvatarRouter verifies a registered public JWKS, issuer, audience, client ID and route scope. No existing user session token, shared account, browser owner cookie or private signing key is shared. This path is optional; API keys need no issuer or JWKS enrollment.
            </p>
          </section>

          <section className="rise">
            <h2 className="mb-3 text-xl font-bold">Repository findings</h2>
            <ul className="space-y-2 text-[15px] leading-relaxed text-muted-foreground">
              <li><b className="text-foreground">RoleplayBot</b> remains the training runtime. AvatarRouter does not replace its dialogue, Gemini, transcript, scoring, ledger, or evaluation logic. The current AvatarRouter audio endpoint is a bounded PCM echo test, not an AI conversation bridge.</li>
              <li><b className="text-foreground">ContentX</b> holds authoring and agent-quality infrastructure with configurable RoleplayX URLs. The name alone is not a runtime identity.</li>
              <li>Production identity is unverified. CC BY-NC licensing means any reuse needs ownership confirmation; no proprietary logic is copied here.</li>
            </ul>
          </section>

          <section className="rise">
            <h2 className="mb-3 text-xl font-bold">LiveKit compatibility matrix</h2>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b text-left">{['Provider', 'JS', 'Python', 'Runtime', 'Audio', 'Validation'].map((h) => <th key={h} className="eyebrow px-3 py-2 font-normal">{h}</th>)}</tr></thead>
                <tbody>{matrix.map((r) => (
                  <tr key={r[0]} className="border-b last:border-0 hover:bg-muted/40">
                    {r.map((c, i) => <td key={i} className={i === 0 ? 'px-3 py-2.5 font-semibold' : 'px-3 py-2.5 text-muted-foreground'}>{c}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <section className="rise">
            <h2 className="mb-3 text-xl font-bold">Gemini audio bridge options</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="A — preferred experiment">
                <p className="p-4 text-sm leading-relaxed">Preserve the session; feed accepted, ordered PCM into the official avatar audio output. Propagate turn flush and interruption. Mute browser AI playback only after avatar tracks are ready; restore on failure. Never forward microphone audio to a second engine.</p>
              </Panel>
              <Panel title="B — not approved">
                <p className="p-4 text-sm leading-relaxed">Move the Gemini runtime into a LiveKit agent. Official plugin exists, but persona switching, reconnect, simulation tools and ledger semantics risk regressions.</p>
              </Panel>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Before approval: measure PCM format/rate, partial-frame buffering, backpressure, turn-complete flush, interruption queue clearing, stale-turn rejection, echo cancellation and join/playback latency with real speech.</p>
          </section>

          <section className="rise space-y-4">
            <h2 className="text-xl font-bold">API requests</h2>
            <p className="text-sm text-muted-foreground">Routes are served under <span className="mono">/api/v1/*</span>. External servers use a project API key. Studio users keep the existing Clerk-and-cookie path; optional delegated JWTs remain supported. Creation returns <span className="mono">rendererState: queued</span>; poll until it is <span className="mono">running</span>. HTTP success is not proof of video or provider cleanup.</p>
            <CopyBlock label="API key — limits:read" code={`curl -sS -H "Authorization: Bearer $AVATAR_ROUTER_API_KEY" \\\\\n  $AVATAR_ROUTER_BASE_URL/live-limits`} />
            <CopyBlock label="advanced: RoleplayX BFF — delegated limits:read request" code={`# Mint a fresh token in the RoleplayX backend after session + tenant checks.\n# Required scope: live-limits:read. Do not send this token to the browser.\ncurl -sS -H "Authorization: Bearer $ROLEPLAYX_DELEGATION_JWT" \\\\\n  ${origin}/api/v1/live-limits`} />
            <CopyBlock label="list providers" code={`curl -s ${origin}/api/v1/providers`} />
            <CopyBlock label="create mock session" code={`curl -s -X POST ${origin}/api/v1/sessions \\\n  -H 'Content-Type: application/json' \\\n  -d '{"providerId":"mock","avatarId":"mock-orbit","mode":"mock"}'`} />
            <CopyBlock label="live stock request (may incur provider charges)" code={`# Use one authorized test user. The service retains the HttpOnly owner cookie.\ncurl -sS -c avatarrouter-cookie.txt -b avatarrouter-cookie.txt \\\\\n  -H "Authorization: Bearer $USER_CLERK_JWT" \\\\\n  -H 'Content-Type: application/json' \\\\\n  -d '{"providerId":"tavus","avatarId":"tavus-stock-lucy","mode":"live","costConfirmed":true}' \\\\\n  ${origin}/api/v1/sessions\n\n# HTTP 201 means queued; poll this session until rendererState is \"running\".`} />
            <CopyBlock label="readiness" code={`curl -s ${origin}/api/ready`} />
          </section>

          <section className="rise">
            <h2 className="mb-3 text-xl font-bold">Current limitations</h2>
            <ul className="grid gap-2 text-sm md:grid-cols-2">
              {['Not OpenAI chat/completions compatible', 'Optional JWKS delegation not enrolled', 'Provider credits are unknown', 'No Gemini-to-avatar streaming proof', 'Image-derived live avatar validation pending', 'No production load or latency sign-off', 'No production launch approval'].map((l) => (
                <li key={l} className="flex items-center gap-2 rounded border bg-card px-3 py-2"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--warn))]" />{l}</li>
              ))}
            </ul>
          </section>
        </article>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Panel title="Milestones">
            <ol className="p-4">
              {milestones.map((m, i) => (
                <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                  <span className={`mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${i === 0 ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground'}`}>{i + 1}</span>
                  <span className="text-[13px] leading-snug">{m}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
