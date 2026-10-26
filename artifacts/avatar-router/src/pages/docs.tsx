import { useGetSetup } from '@workspace/api-client-react';
import { useI18n } from '@/lib/i18n';
import { CopyBlock, PageHead, Panel, Pill } from '@/components/bits';

const origin = typeof window !== 'undefined' ? window.location.origin : '';

const matrix = [
  ['Anam', 'Yes', 'Yes', 'Node', 'DataStreamAudioOutput; requires persona avatar ID', 'No credentials; pending'],
  ['Tavus', 'Yes', 'Yes', 'Node', '24 kHz output, echo transport; inspect package options', 'No credentials; pending'],
  ['LemonSlice', 'Yes', 'Yes', 'Node, later', 'Reuse official plugin; no invented metadata', 'Adapter pending'],
  ['Simli', 'Not listed', 'Yes', 'Python, later', '16 kHz DataStreamAudioOutput', 'Adapter pending'],
];

const milestones = [
  'Independent Studio, mock lifecycle, private image assets and Anam/Tavus creation adapters. Stock Tavus RTC passed; image-derived live validation remains pending.',
  'Authenticated tenant-aware core, persistent metering, SDK/React packages.',
  'LemonSlice and Python Simli adapters with independent validation.',
  'Additive RoleplayX plugin after production runtime is confirmed and audio POC passes.',
  'Complete Studio and secure managed administration.',
  'Operational hardening, load/browser/security validation and release approval.',
];

export default function Docs() {
  const { t } = useI18n();
  const setup = useGetSetup();
  return (
    <div>
      <PageHead index="06 / docs" title={t('docs.title')} lede="Summary of docs/architecture-compatibility.md. Evidence from read-only repository inspection and official LiveKit documentation; nothing here is end-to-end proven." />

      {setup.data && (
        <div className="rise mb-8 flex flex-wrap gap-4 rounded-md border bg-card p-4 text-sm">
          <span className="flex items-center gap-2"><span className="eyebrow">{t('stage')}</span><Pill value={setup.data.stage} /></span>
          <span className="flex items-center gap-2"><span className="eyebrow">RoleplayX</span><Pill value={setup.data.roleplayxStatus} /></span>
          <span className="flex items-center gap-2"><span className="eyebrow">{t('bridge')}</span><Pill value={setup.data.bridgeStatus} /></span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <article className="space-y-10">
          <section className="rise">
            <h2 className="mb-3 text-xl font-bold">Repository findings</h2>
            <ul className="space-y-2 text-[15px] leading-relaxed text-muted-foreground">
              <li><b className="text-foreground">RoleplayBot</b> holds the real training runtime (avatar renderer, audio playback, Gemini handler, ledger, evaluation). Its avatar interface is state/image based, not a PCM media sink — a future plugin needs an additive live-video component plus an audio hook.</li>
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
            <p className="text-sm text-muted-foreground">Public <span className="mono">/v1/*</span> endpoints are served at <span className="mono">/api/v1/*</span>. Sessions are scoped to the creating browser.</p>
            <CopyBlock label="list providers" code={`curl -s ${origin}/api/v1/providers`} />
            <CopyBlock label="create mock session" code={`curl -s -X POST ${origin}/api/v1/sessions \\\n  -H 'Content-Type: application/json' \\\n  -d '{"providerId":"mock","avatarId":"mock-orbit","mode":"mock"}'`} />
            <CopyBlock label="live request (expect 409 until configured)" code={`curl -s -X POST ${origin}/api/v1/sessions \\\n  -H 'Content-Type: application/json' \\\n  -d '{"providerId":"anam","avatarId":"<configured-avatar>","mode":"live"}'`} />
            <CopyBlock label="typescript" code={`import { useCreateSession } from '@workspace/api-client-react';\n\nconst create = useCreateSession();\ncreate.mutate({ data: { providerId: 'mock', avatarId: 'mock-orbit', mode: 'mock' } });`} />
            <CopyBlock label="readiness" code={`curl -s ${origin}/api/ready`} />
          </section>

          <section className="rise">
            <h2 className="mb-3 text-xl font-bold">Current limitations</h2>
            <ul className="grid gap-2 text-sm md:grid-cols-2">
              {['No production identity confirmation', 'No paid provider keys', 'No measured live latency', 'No Gemini-to-avatar E2E proof', 'No production RBAC or tenant credentials', 'No production launch approval'].map((l) => (
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
