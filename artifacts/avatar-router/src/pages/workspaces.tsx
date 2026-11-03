import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { useListDeveloperKeys } from '@workspace/api-client-react';
import { ArrowRight, Boxes, Plus, Search } from 'lucide-react';
import { ErrorState, PageHead, Panel, Skel } from '@/components/bits';
import { useI18n } from '@/lib/i18n';

export default function Workspaces() {
  const { user, isLoaded } = useUser();
  const { lang } = useI18n();
  const t = (en: string, ko: string) => lang === 'ko' ? ko : en;
  const [search, setSearch] = useState('');
  const q = useListDeveloperKeys({ query: { enabled: isLoaded && !!user, refetchInterval: 30000 } });
  const projects = useMemo(() => [...new Map((q.data ?? []).map(key=>[key.projectId,key])).values()].filter(key=>`${key.projectName} ${key.projectId}`.toLowerCase().includes(search.toLowerCase())),[q.data,search]);
  return <div>
    <PageHead index="ACCOUNT / WORKSPACES" title={t('Workspaces','워크스페이스')} lede={t('Manage your personal Studio and isolated integration projects from one account.','개인 Studio와 외부 서비스 연동 프로젝트를 계정에서 구분해 관리하세요.')} right={user && <Link className="arw-button primary" href="/api-keys"><Plus size={14}/>{t('New workspace','새 워크스페이스')}</Link>}/>
    {!isLoaded ? <Skel className="h-40"/> : !user ? <Panel className="p-6"><h2 className="mb-2 text-lg font-semibold">{t('Sign in to manage workspaces','워크스페이스 관리에 로그인하세요')}</h2><p className="mb-5 text-sm text-muted-foreground">{t('Your account owns each integration project. No keys or private assets are shown before sign-in.','로그인한 소유자의 프로젝트만 표시합니다. 로그인 전에는 키·비공개 에셋을 표시하지 않습니다.')}</p><Link href="/sign-in" className="arw-button primary">{t('Sign in','로그인')}</Link></Panel> : <>
      <div className="console-note">{t('Each project created with an API key is a workspace. Existing keys, ownership and assets are unchanged. Creating a new workspace also issues its first project key.','API 키로 생성된 각 프로젝트를 워크스페이스로 표시합니다. 기존 키·소유권·에셋은 유지됩니다. 새 공간을 만들면 첫 프로젝트 키가 함께 발급됩니다.')}</div>
      <Link href="/avatar-assets" className="mb-6 flex items-center justify-between rounded-md border bg-card p-5 hover:border-primary/60" data-testid="link-personal-workspace"><div className="flex gap-3"><Boxes className="text-primary"/><div><h2 className="font-semibold">{t('Personal Studio','개인 Studio')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('Private uploads and Playground · not shared with integration projects','비공개 업로드와 Playground · 외부 연동 프로젝트와 공유되지 않음')}</p></div></div><ArrowRight size={16}/></Link>
      <label className="mb-4 flex max-w-md items-center gap-2 rounded border bg-card px-3 py-2"><Search size={15}/><input aria-label="Search workspaces" placeholder={t('Search workspaces…','워크스페이스 검색…')} value={search} onChange={e=>setSearch(e.target.value)} className="w-full bg-transparent text-sm outline-none"/></label>
      {q.isLoading ? <Skel className="h-40"/> : q.isError ? <ErrorState onRetry={()=>q.refetch()}/> : <Panel><div className="overflow-x-auto"><table className="arw-table w-full"><thead><tr><th>{t('Name','이름')}</th><th>{t('Project','프로젝트')}</th><th>{t('API keys','API 키')}</th><th>{t('Provider billing','제공자 비용')}</th><th/></tr></thead><tbody>
        {projects.map(project=><tr key={project.projectId}><td><Link data-testid={`workspace-${project.projectId}`} href={`/workspaces/${project.projectId}/activity`} className="inline-flex items-center gap-3 py-2 font-semibold hover:text-primary"><Boxes size={18}/>{project.projectName}</Link></td><td className="mono text-xs text-muted-foreground">{project.projectId}</td><td>{q.data?.filter(k=>k.projectId===project.projectId && !k.revokedAt && Date.parse(k.expiresAt)>Date.now()).length} {t('active','활성')}</td><td className="text-muted-foreground">{t('Not connected','미연동 · 확인 불가')}</td><td><Link aria-label={`${project.projectName} 열기`} href={`/workspaces/${project.projectId}/activity`}><ArrowRight size={15}/></Link></td></tr>)}
        {!projects.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">{t('No matching integration projects. Create your first project with New workspace.','일치하는 연동 프로젝트가 없습니다. 새 워크스페이스에서 프로젝트를 생성하세요.')}</td></tr>}
      </tbody></table></div></Panel>}
    </>}
  </div>;
}
