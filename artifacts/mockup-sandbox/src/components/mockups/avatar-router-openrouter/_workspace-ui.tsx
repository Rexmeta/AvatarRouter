import type { ReactNode } from 'react';
import {
  Activity, ArrowLeft, ArrowRight, Bell, BookOpen, Boxes, Check,
  ChevronDown, CircleHelp, Clock3, Code2, FileText, FlaskConical, Grid2X2,
  Image, KeyRound, LockKeyhole, Menu, MoreHorizontal, Search, Settings2,
  ShieldCheck, SlidersHorizontal, UserRound, Wallet, X, type LucideIcon,
} from 'lucide-react';
import type { AccountPage, WorkspacePage } from './_workspace-data';

const iconMap: Record<string, LucideIcon> = {
  activity: Activity, bell: Bell, chart: Activity, file: FileText, grid: Grid2X2,
  image: Image, key: KeyRound, lock: LockKeyhole, settings: Settings2,
  shield: ShieldCheck, sliders: SlidersHorizontal, user: UserRound, wallet: Wallet,
};

export function NavIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Icon = iconMap[name] ?? CircleHelp;
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function PreviewBadge() {
  return <div className="arw-preview"><span className="arw-preview-dot" />디자인 미리보기 · 예시 데이터</div>;
}

export function Brand() {
  return <div className="arw-brand"><span className="arw-brand-mark">ar</span><span>AvatarRouter</span></div>;
}

export function TopBar({
  inWorkspace, workspaces, workspaceId, onWorkspaceChange, onBack,
  onGlobal, mobileOpen, setMobileOpen, search, onSearch,
}: {
  inWorkspace: boolean;
  workspaces: { id: string; name: string }[];
  workspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  onBack: () => void;
  onGlobal: (page: string) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  search: string;
  onSearch: (value: string) => void;
}) {
  return <header className="arw-topbar">
    <div className="arw-top-left">
      <Brand />
      <div className="arw-context">
        <span className="arw-context-divider" />
        <button className="arw-context-button" type="button" onClick={onBack}>
          <span className="arw-personal-dot" />Personal<ChevronDown size={13} />
        </button>
        {inWorkspace && <>
          <span className="arw-crumb-slash">/</span>
          <label className="arw-workspace-select-wrap">
            <span className="sr-only">워크스페이스 선택</span>
            <select className="arw-workspace-select" value={workspaceId ?? ''} onChange={e => onWorkspaceChange(e.target.value)}>
              {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
            <ChevronDown size={13} />
          </label>
        </>}
      </div>
    </div>
    <div className="arw-top-actions">
      <label className="arw-search"><Search size={15} /><input aria-label="워크스페이스 검색" value={search} onChange={e => onSearch(e.target.value)} placeholder="워크스페이스 검색" /></label>
      <nav className="arw-global-nav" aria-label="전역 메뉴">
        <button type="button" onClick={() => onGlobal('avatars')}><Boxes size={14} />아바타</button>
        <button type="button" onClick={() => onGlobal('playground')}><FlaskConical size={14} />Playground</button>
        <button type="button" onClick={() => onGlobal('docs')}><BookOpen size={14} />문서</button>
      </nav>
      <button className="arw-mobile-toggle" type="button" onClick={() => setMobileOpen(!mobileOpen)} aria-label="메뉴 열기">
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
    </div>
  </header>;
}

export function AccountSidebar({
  items, active, onSelect, open, onClose,
}: {
  items: { id: AccountPage; label: string; icon: string; proposal?: boolean }[];
  active: AccountPage;
  onSelect: (id: AccountPage) => void;
  open: boolean;
  onClose: () => void;
}) {
  return <aside className={`arw-sidebar ${open ? 'is-open' : ''}`}>
    <div className="arw-sidebar-label">ACCOUNT</div>
    <nav className="arw-side-nav" aria-label="계정 메뉴">
      {items.map(item => <button key={item.id} type="button" onClick={() => { onSelect(item.id); onClose(); }} className={`arw-side-link ${active === item.id ? 'active' : ''}`}>
        <NavIcon name={item.icon} /><span>{item.label}</span>{item.proposal && <span className="arw-proposed-dot" title="설계 제안" />}
      </button>)}
    </nav>
    <div className="arw-sidebar-foot"><span className="arw-status-dot" />미리보기 환경</div>
  </aside>;
}

export function WorkspaceSidebar({
  items, active, onSelect, onBack, open, onClose,
}: {
  items: { id: WorkspacePage; label: string; icon: string }[];
  active: WorkspacePage;
  onSelect: (id: WorkspacePage) => void;
  onBack: () => void;
  open: boolean;
  onClose: () => void;
}) {
  return <aside className={`arw-sidebar ${open ? 'is-open' : ''}`}>
    <button className="arw-back-account" type="button" onClick={onBack}><ArrowLeft size={14} />계정 관리</button>
    <div className="arw-sidebar-label workspace-label">WORKSPACE</div>
    <nav className="arw-side-nav" aria-label="워크스페이스 메뉴">
      {items.map(item => <button key={item.id} type="button" onClick={() => { onSelect(item.id); onClose(); }} className={`arw-side-link ${active === item.id ? 'active' : ''}`}>
        <NavIcon name={item.icon} /><span>{item.label}</span>
      </button>)}
    </nav>
    <div className="arw-sidebar-foot"><span className="arw-status-dot" />현재 공간에 한정</div>
  </aside>;
}

export function PageHeading({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description: string; action?: ReactNode;
}) {
  return <div className="arw-page-heading">
    <div><div className="arw-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>
    {action && <div className="arw-heading-action">{action}</div>}
  </div>;
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`arw-panel ${className}`}>{children}</section>;
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'violet' }) {
  return <div className={`arw-notice ${tone}`}><span className="arw-notice-mark">{tone === 'warning' ? '!' : 'i'}</span><div>{children}</div></div>;
}

export function EmptyState({ icon = 'file', title, description, action }: {
  icon?: string; title: string; description: string; action?: ReactNode;
}) {
  return <div className="arw-empty"><div className="arw-empty-icon"><NavIcon name={icon} size={18} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="arw-modal-scrim" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="arw-modal" role="dialog" aria-modal="true" aria-labelledby="arw-modal-title">
      <div className="arw-modal-head"><h2 id="arw-modal-title">{title}</h2><button type="button" className="arw-icon-button" onClick={onClose} aria-label="닫기"><X size={17} /></button></div>
      {children}
    </section>
  </div>;
}

export function WorkspaceMark({ kind }: { kind: 'development' | 'production' | 'local' }) {
  return <span className={`arw-workspace-mark ${kind}`} aria-hidden="true"><Grid2X2 size={15} /></span>;
}

export function QuietLink({ children }: { children: ReactNode }) {
  return <span className="arw-quiet-link">{children}<ArrowRight size={13} /></span>;
}

export function AccountBackIcon() {
  return <ArrowLeft size={14} />;
}

export function MoreIcon() {
  return <MoreHorizontal size={16} />;
}

export function CheckIcon() {
  return <Check size={14} />;
}

export function ClockIcon() {
  return <Clock3 size={14} />;
}

export function CodeIcon() {
  return <Code2 size={14} />;
}

export function WalletIcon() {
  return <Wallet size={14} />;
}
