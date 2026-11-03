import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { useListDeveloperKeys } from '@workspace/api-client-react';
import { Activity, ArrowLeft, BookOpen, Boxes, FlaskConical, ImageUp, KeyRound, ListTree, Menu, Settings, ShieldCheck, UserRound, X } from 'lucide-react';
import { AuthControl } from './auth-control';
import { useI18n } from '@/lib/i18n';

export function Shell({ children }: { children: ReactNode }) {
  const [loc, navigate] = useLocation();
  const { user, isLoaded } = useUser();
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ko = lang === 'ko';
  const t = (en: string, kr: string) => ko ? kr : en;
  const projects = useListDeveloperKeys({ query: { enabled: isLoaded && !!user, refetchInterval: 30000 } });
  const items = [...new Map((projects.data ?? []).map(key => [key.projectId, key])).values()];
  const projectId = loc.match(/^\/workspaces\/([^/?]+)/)?.[1];
  const personal = /^\/(avatar-assets|playground|sessions|usage)/.test(loc);
  const inside = !!projectId || personal;
  const base = projectId ? `/workspaces/${projectId}` : '';
  const navigation = inside ? [
    [projectId ? `${base}/activity` : '/usage', Activity, t('Activity', '활동')],
    [projectId ? `${base}/sessions` : '/sessions', ListTree, t('Sessions & logs', '세션·로그')],
    ...(projectId ? [[`${base}/keys`, KeyRound, t('API keys', 'API 키')]] : []),
    [projectId ? `${base}/assets` : '/avatar-assets', ImageUp, t('Avatars & assets', '아바타·에셋')],
    [projectId ? `${base}/limits` : '/usage', ShieldCheck, t('Usage & limits', '사용량·한도')],
    ...(projectId ? [[`${base}/settings`, Settings, t('Settings', '설정')]] : [['/playground', FlaskConical, 'Playground']]),
  ] : [
    ['/workspaces', Boxes, t('Workspaces', '워크스페이스')],
    ['/account/profile', UserRound, t('Profile & security', '프로필·보안')],
    ['/api-keys', KeyRound, t('All API keys', '전체 API 키')],
    ['/account/preferences', Settings, t('Preferences', '환경설정')],
  ];
  return <div className="ar-workspaces">
    <header className="arw-topbar">
      <div className="arw-top-left">
        <Link href="/workspaces" className="arw-brand"><span className="arw-brand-mark">ar</span><span>AvatarRouter</span></Link>
        <div className="arw-context">
          <Link href="/workspaces" className="arw-context-button"><UserRound size={13} />{user?.firstName || t('Account', '계정')}</Link>
          {inside && <><span className="arw-crumb-slash">/</span><select aria-label={t('Select workspace', '워크스페이스 선택')} data-testid="select-workspace" className="max-w-[230px] truncate rounded border border-border bg-card px-2 py-1 text-sm" value={projectId || 'personal'} onChange={e => { setOpen(false); navigate(e.target.value === 'personal' ? '/avatar-assets' : `/workspaces/${e.target.value}/activity`); }}>
            <option value="personal">{t('Personal Studio', '개인 Studio')}</option>
            {items.map(key => <option key={key.projectId} value={key.projectId}>{key.projectName}</option>)}
            {projectId && !items.some(k=>k.projectId===projectId) && <option value={projectId}>{t('Loading workspace…', '공간 확인 중…')}</option>}
          </select></>}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <nav className="console-public-nav flex items-center gap-5" aria-label="Product">
          <Link className="console-toplink" href="/providers"><Boxes size={14}/>{t('Avatars & providers','아바타·제공자')}</Link>
          <Link className="console-toplink" href="/playground"><FlaskConical size={14}/>Playground</Link>
          <Link className="console-toplink" href="/docs"><BookOpen size={14}/>{t('Docs','문서')}</Link>
        </nav>
        <AuthControl />
        <button className="console-mobile rounded border p-2" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={()=>setOpen(!open)}>{open ? <X size={17}/> : <Menu size={17}/>}</button>
      </div>
    </header>
    <div className="console-layout">
      <aside className={`arw-sidebar ${open ? 'is-open' : ''}`}>
        {inside && <Link className="arw-back-account" href="/workspaces" onClick={()=>setOpen(false)}><ArrowLeft size={14}/>{t('Account management','계정 관리')}</Link>}
        <div className="arw-sidebar-label">{inside ? 'WORKSPACE' : 'ACCOUNT'}</div>
        <nav aria-label={inside ? 'Workspace' : 'Account'}>
          {navigation.map(([href, Icon, label],i) => {
            const Component = Icon as typeof Activity;
            return <Link key={`${href}-${i}`} href={href as string} className="console-navlink" aria-current={loc === href || loc.startsWith(`${href}/`) ? 'page' : undefined} onClick={()=>setOpen(false)}><Component size={16}/>{label as string}</Link>;
          })}
          <div className="arw-sidebar-label">{t('PRODUCT','제품')}</div>
          <Link className="console-navlink" href="/providers" onClick={()=>setOpen(false)}><Boxes size={16}/>{t('Avatars & providers','아바타·제공자')}</Link>
          <Link className="console-navlink" href="/docs" onClick={()=>setOpen(false)}><BookOpen size={16}/>{t('Documentation','연동 문서')}</Link>
        </nav>
        <div className="arw-sidebar-foot flex-col items-start gap-3">
          <button className="rounded border px-3 py-1" onClick={()=>setLang(ko ? 'en' : 'ko')}>{ko ? 'English' : '한국어'}</button>
          <Link href="/operator/live-reconciliation" className="text-xs hover:underline">{t('Operator console · restricted','운영자 콘솔 · 권한 필요')}</Link>
        </div>
      </aside>
      <main className="arw-main">
        {inside && <div className="console-scope">{projectId ? t('Project workspace · its keys and assets only. Personal Studio stays separate.','프로젝트 워크스페이스 · 해당 프로젝트의 키·에셋만 표시합니다. 개인 Studio와 분리됩니다.') : t('Personal Studio · separate from integration project API keys and assets.','개인 Studio · 연동 프로젝트 API 키·에셋과 별도인 공간입니다.')}</div>}
        <div className="console-content">{children}</div>
      </main>
    </div>
  </div>;
}
