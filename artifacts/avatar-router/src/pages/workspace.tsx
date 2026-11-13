import { Link, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import { useGetDeveloperWorkspace, getGetDeveloperWorkspaceQueryKey, useGetDeveloperWorkspaceEvents } from '@workspace/api-client-react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { ErrorState, PageHead, Panel, Pill, Skel, fmtTime } from '@/components/bits';
import ApiKeys from './api-keys';
import AvatarAssets from './avatar-assets';
import { WorkspaceAssetContext } from '@/lib/workspace-assets';
import { useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { LiveAdmissionNotice } from '@/components/live-admission-notice';
import { WorkspaceLiveCheckPanel } from '@/components/workspace-live-check-panel';
import { WorkspaceBudgetPanel } from '@/components/workspace-budget-panel';
import { useWorkspaceLiveCheck } from '@/lib/use-workspace-live-check';
import { SessionTiming } from '@/components/session-timing';

function LiveCheckSection({ projectId }: { projectId: string }) {
  const check = useWorkspaceLiveCheck(projectId);
  return <WorkspaceLiveCheckPanel check={check}/>;
}

function SessionEvents({ projectId, id }: {projectId:string;id:string}) {
  const [open,setOpen] = useState(false);
  const q = useGetDeveloperWorkspaceEvents(projectId,id,{query:{enabled:open,refetchInterval:open ? 10000 : false}});
  return <div className="mt-3"><button className="text-xs text-primary underline-offset-2 hover:underline" onClick={()=>setOpen(!open)}>{open ? '−' : '+'} Events / 로그</button>{open && <div className="mt-3 space-y-2 rounded border p-3">
    {q.isLoading ? <Skel className="h-12"/> : q.isError ? <ErrorState onRetry={()=>q.refetch()}/> : !q.data?.length ? <span className="text-xs text-muted-foreground">No events / 기록 없음</span> : q.data?.map(e=><div key={e.id} className="max-w-lg whitespace-normal text-xs"><span className="text-muted-foreground">{fmtTime(e.createdAt)} · {e.type}</span><p className="mt-1">{e.message}</p></div>)}
  </div>}</div>;
}

export default function Workspace() {
  const { projectId = '', section = 'activity' } = useParams<{projectId:string;section?:string;id?:string}>();
  const { user, isLoaded } = useUser();
  const { lang } = useI18n();
  const t = (en: string, ko: string) => lang === 'ko' ? ko : en;
  const q = useGetDeveloperWorkspace(projectId, { query: { queryKey: getGetDeveloperWorkspaceQueryKey(projectId), enabled: isLoaded && !!user, refetchInterval: 10000, retry: false } });
  if (!isLoaded || user && q.isLoading) return <Skel className="h-64"/>;
  if (!user) return <Panel className="p-6"><p className="mb-4">{t('Sign in to access this workspace.','워크스페이스에 접근하려면 로그인하세요.')}</p><Link className="arw-button primary" href="/sign-in">{t('Sign in','로그인')}</Link></Panel>;
  if (q.isError || !q.data) return <div><PageHead index="WORKSPACE" title={t('Workspace unavailable','워크스페이스에 접근할 수 없습니다')} lede={t('The project may not exist or may belong to another account. No project data is shown.','존재하지 않거나 다른 계정 소유인 프로젝트일 수 있습니다. 프로젝트 데이터는 표시하지 않습니다.')}/><ErrorState onRetry={()=>q.refetch()}/><Link href="/workspaces" className="arw-button mt-5">{t('Back to account','계정으로 돌아가기')}</Link></div>;
  const w = q.data;
  const base = `/workspaces/${projectId}`;
  if (section === 'keys') return <><LiveAdmissionNotice limits={w.limits}/><ApiKeys key={projectId} projectId={projectId}/></>;
  if (section === 'assets') return <WorkspaceAssetContext.Provider value={projectId}><LiveAdmissionNotice limits={w.limits}/><AvatarAssets key={projectId}/></WorkspaceAssetContext.Provider>;
  if (section === 'live-check') return <LiveCheckSection key={`${projectId}:${user.id}`} projectId={projectId}/>;
  const pending = w.limits.cleanupPending;
  return <div>
    <PageHead index={`WORKSPACE / ${section.toUpperCase()}`} title={section === 'settings' ? t('Workspace settings','워크스페이스 설정') : section === 'limits' ? t('Usage & limits','사용량·한도') : section === 'sessions' ? t('Sessions & logs','세션·로그') : w.projectName} lede={`${w.projectName} · ${projectId}`}/>
    {!pending && <LiveAdmissionNotice limits={w.limits}/>}
    {!!pending && <div role="alert" className="console-note console-warning flex items-start gap-3"><AlertTriangle size={18} className="shrink-0"/><div><strong>{t('Previous session cleanup needs confirmation','이전 세션의 생성·종료 결과 확인이 필요합니다')}</strong><p className="mt-2">{t(`${pending} unresolved session(s). An operator must verify cleanup. Viewing this screen or refreshing does not clear the paid-start block.`,`${pending}개 세션이 미확인 상태입니다. 운영자의 확인·정리가 필요하며, 화면 새로고침이나 설정 변경으로 유료 연결 차단이 해제되지 않습니다.`)}</p><span className="mono text-xs">avatar_provider_cleanup_required</span><Link href="/operator/live-reconciliation" className="mt-3 block text-sm underline">{t('Operator: manage termination & cleanup','운영자: 종료·정리 관리 화면 열기')}</Link><p className="mt-1 text-xs text-muted-foreground">{t('A trusted operator account is required; a project API key cannot perform operator actions.','승인된 운영자 계정이 필요합니다. 프로젝트 API 키만으로는 운영자 작업을 수행할 수 없습니다.')}</p></div></div>}
    {section === 'settings' ? <Panel className="p-5"><dl className="space-y-5 text-sm"><div><dt className="eyebrow">{t('Workspace name','워크스페이스 이름')}</dt><dd className="mt-2">{w.projectName}</dd></div><div><dt className="eyebrow">Project ID</dt><dd className="mono mt-2 break-all">{w.projectId}</dd></div><div><dt className="eyebrow">{t('Access boundary','접근 범위')}</dt><dd className="mt-2">{t('Interactive project owner only. No member sharing or operator grants are implied.','로그인한 프로젝트 소유자만 관리합니다. 멤버 공유나 운영자 권한 부여 기능은 제공하지 않습니다.')}</dd></div></dl><Link className="arw-button mt-6" href={`${base}/keys`}>{t('Manage keys & permissions','키·권한 관리')}<ArrowRight size={14}/></Link><p className="mt-4 text-xs text-muted-foreground">{t('Project rename and deletion are not currently supported. Revoking a key does not terminate existing provider sessions.','프로젝트 이름 변경·삭제는 현재 지원하지 않습니다. 키 폐기는 기존 제공자 세션의 종료를 의미하지 않습니다.')}</p></Panel> : section === 'limits' ? <>
      <WorkspaceBudgetPanel key={`${user.id}:${projectId}`} projectId={projectId} userId={user.id}/>
      <div className="console-note mt-5 flex items-center gap-2">{t('Worker','워커')} <Pill value={w.limits.workerReady ? 'ready' : 'unavailable'}/></div>
    </> : <>
      {section !== 'sessions' && <div className="mb-6 grid gap-4 sm:grid-cols-3">{[
        [t('Recent sessions · max 200','최근 세션 · 최대 200'),w.sessions.length],
        [t('Pending cleanup','정리 확인 필요'),pending],
        [t('Active API keys','활성 API 키'),w.keys.filter(k=>!k.revokedAt && Date.parse(k.expiresAt)>Date.now()).length],
      ].map(([label,value])=><Panel key={label} className="p-5"><div className="eyebrow">{label}</div><div className="mt-3 text-3xl font-semibold">{value}</div></Panel>)}</div>}
      <Panel title={t('Recent project sessions','최근 프로젝트 세션')}>
        {!w.sessions.length ? <p className="p-8 text-center text-sm text-muted-foreground">{t('No sessions in this project yet. Personal Studio history belongs to a separate space.','이 프로젝트에 세션이 없습니다. 개인 Studio 이력은 별도 공간에 속합니다.')}</p> : <div className="overflow-x-auto"><table className="arw-table w-full"><thead><tr><th>{t('Session','세션')}</th><th>{t('Provider / avatar','제공자 / 아바타')}</th><th>{t('Status','상태')}</th><th>{t('Started','시작')}</th></tr></thead><tbody>{w.sessions.map(s=><tr key={s.id}><td className="mono text-xs">{s.id}<div className="mt-2 text-muted-foreground">{s.mode} · {s.rendererState || s.status}</div></td><td>{s.providerId}<div className="mt-1 text-xs text-muted-foreground">{s.avatarId}</div></td><td><Pill value={s.status}/>{s.cleanupPending && <div className="mt-2 text-xs text-amber-300">{t('Cleanup required','정리 확인 필요')}</div>}{s.error && <div className="mt-2 max-w-xs break-all text-xs text-destructive">{s.error}</div>}</td><td className="text-xs">{fmtTime(s.startedAt)}</td></tr>)}</tbody></table></div>}
      </Panel>
      {section === 'sessions' && w.sessions.length>0 && <Panel title={t('Session lifecycle logs','세션 생명주기 로그')} className="mt-6"><div className="divide-y">{w.sessions.map(s=><div key={s.id} className="p-4"><div className="mono break-all text-xs">{s.id}</div><div className="my-3"><SessionTiming session={s}/></div><SessionEvents projectId={projectId} id={s.id}/></div>)}</div></Panel>}
      <div className="console-note">{t('Includes all user contexts within this project. Read-only session history; raw operator diagnostics are not exposed. End requests and user-specific event logs remain available through the authorized integration API.','이 프로젝트의 사용자 컨텍스트별 세션을 함께 표시합니다. 세션 이력은 조회 전용이며 운영자 전용 진단은 노출하지 않습니다. 종료 요청과 사용자별 이벤트 로그는 권한을 검증하는 연동 API에서 처리합니다.')}</div>
      <div className="flex flex-wrap gap-3"><Link className="arw-button" data-testid="link-live-check" href={`${base}/live-check`}>{t('Live media check','라이브 미디어 점검')}</Link><Link className="arw-button" href={`${base}/keys`}>{t('API keys','API 키')}</Link><Link className="arw-button" href={`${base}/assets`}>{t('Avatars & assets','아바타·에셋')}</Link><Link className="arw-button" href="/docs">{t('Integration guide','연동 가이드')}</Link></div>
    </>}
  </div>;
}
