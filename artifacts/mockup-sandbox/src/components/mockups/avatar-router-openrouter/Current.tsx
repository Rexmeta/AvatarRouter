import './_group.css';
import { ArrowUpRight, ExternalLink, LogIn, ImageUp } from 'lucide-react';
import { Link,useListProvisioningProviders,getListProvisioningProvidersQueryKey,type ProvisioningProvider } from './_stubs';
import {useI18n,I18nProvider} from './_i18n';
import {PageHead,Panel,Skel,ErrorState,Pill} from './_bits';
import {cn} from '@/lib/utils';
import {Shell} from './_Shell';
function useL() {
  const { lang } = useI18n();
  return (en: string, ko: string) => (lang === 'en' ? en : ko);
}


function StockEntry() {
  const L = useL();
  return (
    <Link href="/playground#stock" data-testid="link-stock-playground" className="rise mb-6 flex items-center justify-between gap-4 rounded-md border border-primary/40 bg-primary/5 px-4 py-3 transition hover:bg-primary/10">
      <span>
        <span className="block text-sm font-semibold">{L('Test a stock Tavus avatar live first', '먼저 기본 Tavus 아바타로 라이브 테스트')}</span>
        <span className="block text-xs text-muted-foreground">{L('Lucy - Home. No upload or training needed. Opens the stock panel in Playground.', 'Lucy - Home. 업로드나 학습이 필요 없습니다. 플레이그라운드의 기본 아바타 패널로 이동합니다.')}</span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-primary" />
    </Link>
  );
}

function SignedOutGate() {
  const L = useL();
  return (
    <Panel className="overflow-hidden">
      <div className="grid md:grid-cols-[1fr_auto]">
        <div className="p-6">
          <div className="eyebrow mb-2">{L('Private workspace', '비공개 작업 공간')}</div>
          <h2 className="text-xl font-semibold">{L('Sign in to see your images and avatars.', '이미지와 아바타를 보려면 로그인하세요.')}</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            {L('Uploads are scoped to your account and never listed publicly. Provider capabilities below are public.', '업로드는 계정 단위로 격리되며 공개되지 않습니다. 아래 프로바이더 기능 정보는 공개입니다.')}
          </p>
          <div className="mt-5 flex gap-2">
            <Link href="/sign-in" data-testid="link-gate-sign-in" className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[.97]">
              <LogIn className="h-4 w-4" /> {L('Sign in', '로그인')}
            </Link>
            <Link href="/sign-up" data-testid="link-gate-sign-up" className="inline-flex items-center gap-2 rounded border px-4 py-2 text-sm transition hover:bg-muted">
              {L('Create account', '계정 만들기')}
            </Link>
          </div>
        </div>
        <div className="hidden items-center border-l bg-muted/50 px-10 md:flex">
          <ImageUp className="h-16 w-16 text-muted-foreground/40" strokeWidth={1} />
        </div>
      </div>
    </Panel>
  );
}


function providerBlock(p: ProvisioningProvider, L: (a: string, b: string) => string): string | null {
  if (!p.adapterEnabled) return L('Documented only — adapter not enabled in this deployment.', '문서화만 됨 — 이 배포에서 어댑터 비활성.');
  if (!p.configured) return L('Adapter present but provider credentials are not configured.', '어댑터는 있지만 프로바이더 자격 증명이 설정되지 않았습니다.');
  if (!p.imageCreation) return L('Provider does not create avatars from images.', '이미지로 아바타를 생성하지 않습니다.');
  return null;
}


function CapabilityPanel() {
  const L = useL();
  const q = useListProvisioningProviders({ query: { queryKey: getListProvisioningProvidersQueryKey(), staleTime: 60000 } });
  const flags: [keyof ProvisioningProvider, string][] = [
    ['imageCreation', L('Image → avatar', '이미지 → 아바타')], ['customTraining', L('Training', '학습')],
    ['reusableId', L('Reusable ID', '재사용 ID')], ['realtimeRendering', L('Realtime', '실시간')],
  ];
  return (
    <Panel title={L('Provisioning capabilities', '프로비저닝 기능')} aside={<span className="mono text-[10.5px] text-muted-foreground">{L('public', '공개')}</span>}>
      {q.isLoading ? <div className="p-4"><Skel className="h-40" /></div>
        : q.isError ? <div className="p-4"><ErrorState onRetry={() => q.refetch()} /></div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="mono border-b text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">{L('Provider', '프로바이더')}</th>
                {flags.map(([, l]) => <th key={l} className="px-2 py-2 font-medium">{l}</th>)}
                <th className="px-2 py-2 font-medium">{L('Emotion', '감정')}</th>
                <th className="px-2 py-2 font-medium">{L('Adapter', '어댑터')}</th>
                <th className="px-4 py-2 font-medium">{L('Requirements', '요구 사항')}</th>
              </tr></thead>
              <tbody className="divide-y">
                {q.data?.map((p) => (
                  <tr key={p.id} data-testid={`row-capability-${p.id}`} className={cn(!p.adapterEnabled && 'text-muted-foreground')}>
                    <td className="px-4 py-3 font-semibold">{p.name}</td>
                    {flags.map(([k]) => <td key={k} className="mono px-2 py-3 text-xs">{p[k] ? L('yes', '예') : '—'}</td>)}
                    <td className="mono px-2 py-3 text-xs">{p.emotionControl}</td>
                    <td className="px-2 py-3">
                      <Pill value={!p.adapterEnabled ? 'ended' : p.configured ? 'available' : 'unconfigured'} label={!p.adapterEnabled ? L('documented', '문서만') : p.configured ? L('enabled', '활성') : L('unconfigured', '미설정')} />
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs">
                      {p.requirements}{' '}
                      <a href={p.id === 'tavus' ? 'https://docs.tavus.io' : 'https://docs.anam.ai'} target="_blank" rel="noreferrer" data-testid={`link-docs-${p.id}`} className="inline-flex items-center gap-0.5 text-primary hover:underline">docs <ExternalLink className="h-3 w-3" /></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  );
}

function Content(){const L=useL();return <Shell><PageHead index="02b / avatar assets" title={L('Avatar assets','아바타 에셋')} lede={L('Ingest a source image you hold rights to, then ask a provider to build a reusable avatar from it. Every state here is what the server and provider actually report.','권리를 보유한 원본 이미지를 업로드하고 프로바이더에 재사용 가능한 아바타 생성을 요청하세요. 여기의 모든 상태는 서버와 프로바이더가 실제로 보고한 값입니다.')} /><StockEntry/><SignedOutGate/><div className="mt-8"><CapabilityPanel/></div></Shell>};
export function Current(){return <I18nProvider><Content/></I18nProvider>}
