import './_workspace.css';
import { useMemo, useState } from 'react';
import { Check, ChevronRight, Grid2X2, KeyRound, Plus, UserRound, Video } from 'lucide-react';
import {
  accountNavigation, initialWorkspaces, proposedMappingNote, workspaceNavigation,
  type AccountPage, type PublicPage, type Workspace, type WorkspacePage,
} from './_workspace-data';
import {
  AccountSidebar, EmptyState, Modal, Notice, PageHeading, Panel, PreviewBadge,
  TopBar, WorkspaceMark, WorkspaceSidebar,
} from './_workspace-ui';

type LocalPreference = { compact: boolean; notices: boolean; confirmCost: boolean };

const accountLabels: Record<AccountPage, string> = {
  workspaces: '워크스페이스', profile: '프로필', 'account-activity': '계정 활동',
  'account-logs': '계정 로그', credits: '크레딧', 'account-guardrails': '계정 사용 한도',
  'management-keys': '관리 키', notifications: '알림', privacy: '개인정보',
  security: '보안', preferences: '환경설정',
};

function WorkspaceList({
  workspaces, filter, onFilter, onOpen, onCreate,
}: {
  workspaces: Workspace[];
  filter: string;
  onFilter: (value: string) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const rows = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return workspaces.filter(item => !query || `${item.name} ${item.description}`.toLocaleLowerCase().includes(query));
  }, [filter, workspaces]);
  return <>
    <PageHeading eyebrow="Account / workspaces" title="워크스페이스" description="계정에서 각 프로젝트 환경을 분리해 관리합니다. 현재 화면의 공간 구분은 제품 UX 제안이며, 실제 프로젝트를 만들거나 옮기지 않습니다."
      action={<button className="arw-button primary" type="button" onClick={onCreate}><Plus size={14} />새 워크스페이스</button>} />
    <Notice tone="violet"><strong>계정 관리와 공간 관리를 구분합니다.</strong> 아래 샘플 공간을 열면 해당 공간의 키·사용량·세션·에셋만 확인할 수 있습니다. 이 모형은 프로젝트 생성, 이름 변경, 이관을 실행하지 않습니다.</Notice>
    <div className="arw-section-title"><h2>내 워크스페이스</h2><span>예시 공간 {workspaces.length}개</span></div>
    <Panel>
      <div className="arw-table-wrap"><table className="arw-table">
        <thead><tr><th>이름</th><th>설명</th><th>Provider 비용</th><th>API 키</th><th /></tr></thead>
        <tbody>
          {rows.map(workspace => <tr className="workspace-row" key={workspace.id} onClick={() => onOpen(workspace.id)} onKeyDown={e => e.key === 'Enter' && onOpen(workspace.id)} tabIndex={0}>
            <td><div className="arw-name-cell"><WorkspaceMark kind={workspace.kind} /><div><div className="arw-workspace-title">{workspace.name}</div><div className="arw-workspace-sub">{workspace.kind === 'development' ? '개발 환경 · 샘플' : workspace.kind === 'production' ? '운영 환경 · 샘플' : '이 기기에서만 추가됨'}</div></div></div></td>
            <td className="arw-cell-muted">{workspace.description}</td>
            <td><span className="arw-pill">미연동 · 확인 불가</span></td>
            <td>{workspace.sampleKey ? <span className="arw-pill violet">샘플 표시</span> : <span className="arw-cell-muted">표시할 키 없음</span>}</td>
            <td className="arw-table-end"><button className="arw-inline-action" type="button" onClick={e => { e.stopPropagation(); onOpen(workspace.id); }}>열기<ChevronRight size={14} /></button></td>
          </tr>)}
          {!rows.length && <tr><td colSpan={5}><EmptyState icon="grid" title="검색 결과가 없습니다" description="검색어를 바꾸거나 지워서 워크스페이스를 다시 확인하세요." action={<button className="arw-button" onClick={() => onFilter('')}>검색 지우기</button>} /></td></tr>}
        </tbody>
      </table></div>
    </Panel>
    <p className="arw-footnote">비용이나 요청량은 실제 provider 데이터가 연결되지 않아 집계할 수 없습니다. 샘플 키는 credential이 아니며 사용할 수 없습니다.</p>
    <div className="arw-account-overview">
      <Panel><div className="arw-key-row"><div><div className="arw-workspace-title">계정과 프로젝트의 경계</div><div className="arw-workspace-sub">Studio 개인 네임스페이스 ≠ API 키 프로젝트 네임스페이스</div></div><span className="arw-pill">분리 유지</span></div>
        <div className="arw-key-row"><span className="arw-cell-muted">워크스페이스 간 데이터 복사 또는 키 공유</span><span className="arw-cell-muted">수행하지 않음</span></div>
      </Panel>
      <div className="arw-summary-card"><div className="arw-summary-label">현재 상태</div><div className="arw-summary-value">로컬 미리보기</div><div className="arw-summary-note">서버 저장 없음 · 예시 데이터</div></div>
    </div>
  </>;
}

function AccountHomePage({ page, preferences, onPreference }: {
  page: Exclude<AccountPage, 'workspaces'>;
  preferences: LocalPreference;
  onPreference: (key: keyof LocalPreference) => void;
}) {
  const title = accountLabels[page];
  if (page === 'account-activity') return <>
    <PageHeading eyebrow="Account / activity" title={title} description="계정 수준 이벤트를 확인합니다. 아래 항목은 미리보기 동작 이력이며 실제 서비스 기록이 아닙니다." />
    <Panel>
      <div className="arw-event"><span className="arw-event-icon"><Grid2X2 size={14} /></span><div className="arw-event-body"><div className="arw-event-title">워크스페이스 목록을 열었습니다</div><div className="arw-event-desc">계정 전환 및 예시 공간 목록 · 미리보기 로컬 이벤트</div></div><span className="arw-event-time">방금 · 샘플</span></div>
      <div className="arw-event"><span className="arw-event-icon"><UserRound size={14} /></span><div className="arw-event-body"><div className="arw-event-title">프로필 · 보안 설정은 조회 전용</div><div className="arw-event-desc">인증된 계정이나 저장된 변경 사항이 없습니다.</div></div><span className="arw-event-time">예시</span></div>
    </Panel>
    <p className="arw-footnote">실제 계정 활동 기록과 감사 로그는 이 프로토타입에서 불러오지 않습니다.</p>
  </>;
  if (page === 'account-logs') return <>
    <PageHeading eyebrow="Account / logs" title={title} description="계정 범위의 감사 로그 영역입니다. 실제 로그가 연결되지 않은 상태를 그대로 표시합니다." />
    <Panel><EmptyState icon="file" title="계정 로그를 불러오지 않았습니다" description="로그 수집 API와 인증이 연결되지 않아 이 화면은 비어 있습니다. 워크스페이스의 세션 로그와는 별도 범위입니다." /></Panel>
  </>;
  if (page === 'profile') return <>
    <PageHeading eyebrow="Account / profile" title={title} description="개인 계정에 대한 표시 예시입니다. 실제 프로필 값이나 사용자 식별 정보는 노출하지 않습니다." />
    <Panel>
      <div className="arw-key-row"><div><div className="arw-workspace-title">계정 표시 이름</div><div className="arw-workspace-sub">Personal · 이름 정보 미연결</div></div><span className="arw-pill">미리보기</span></div>
      <div className="arw-key-row"><div><div className="arw-workspace-title">이메일</div><div className="arw-workspace-sub">표시하지 않음</div></div><span className="arw-cell-muted">계정 데이터 없음</span></div>
      <div className="arw-key-row"><div><div className="arw-workspace-title">워크스페이스 역할</div><div className="arw-workspace-sub">역할 기반 접근 제어는 제품 설계 제안</div></div><span className="arw-pill">미구현</span></div>
    </Panel>
  </>;
  if (page === 'security') return <>
    <PageHeading eyebrow="Account / security" title={title} description="인증 및 보안 상태를 실제로 확인하지 않습니다. 역할 부여나 계정 권한 변경도 제공하지 않습니다." />
    <div className="arw-detail-grid">
      <div className="arw-detail-tile"><h3>로그인 보호</h3><p>인증 제공자 연동 전이므로 세션, MFA, 로그인 기록을 확인할 수 없습니다.</p></div>
      <div className="arw-detail-tile"><h3>프로젝트 API key</h3><p>RoleplayX의 서버 측 비밀 저장소에 보관하세요. 계정 프로필은 프로젝트 API 키를 대신하지 않습니다.</p></div>
      <div className="arw-detail-tile"><h3>역할·초대</h3><p>역할 관리는 설계 제안입니다. 권한 부여, 자기 승격, 초대를 실행하는 기능은 없습니다.</p></div>
      <div className="arw-detail-tile"><h3>연결 상태</h3><p><span className="arw-pill">인증 미연동</span></p></div>
    </div>
  </>;
  if (page === 'preferences') return <>
    <PageHeading eyebrow="Account / preferences" title={title} description="화면 설정 예시입니다. 변경은 이 브라우저 세션에만 유지되고 서버에 저장되지 않습니다." />
    <Panel>
      <PreferenceRow title="밀도 높은 목록" description="행 간격을 줄이는 환경설정 예시" checked={preferences.compact} onChange={() => onPreference('compact')} />
      <PreferenceRow title="화면 내 안내 표시" description="미리보기 맥락과 보안 안내를 유지합니다." checked={preferences.notices} onChange={() => onPreference('notices')} />
      <PreferenceRow title="유료 작업 전 확인 기본값" description="라이브 세션을 자동 시작하지 않으며 동의 없는 호출을 허용하지 않습니다." checked={preferences.confirmCost} onChange={() => onPreference('confirmCost')} />
    </Panel>
    <p className="arw-footnote">각 설정은 UI 상태만 바꾸며 세션을 만들거나 결제를 승인하지 않습니다.</p>
  </>;
  const copy: Record<Exclude<AccountPage, 'workspaces' | 'profile' | 'account-activity' | 'account-logs' | 'security' | 'preferences'>, { desc: string; title: string; icon: string; message: string }> = {
    credits: { title: 'Provider 크레딧', desc: 'AvatarRouter에서 provider 잔액을 조회할 수 있는지 확인합니다.', icon: 'wallet', message: 'Provider billing이 연결되지 않아 잔액은 미연동 · 확인 불가입니다. $0으로 간주하지 않습니다.' },
    'account-guardrails': { title: '계정 사용 한도', desc: '계정 단위 비용·요청 한도는 실제 서버 정책과 연결되어야 합니다.', icon: 'shield', message: '계정 전체 한도 설정 API가 없습니다. 현재 값이나 집계 총액을 추정해 표시하지 않습니다.' },
    'management-keys': { title: '관리 키', desc: '계정 설정을 관리하는 자격 증명 영역입니다.', icon: 'key', message: '관리 키 기능은 현재 제품 범위에서 확인되지 않았습니다. 이 화면은 키를 발급하거나 표시하지 않습니다.' },
    notifications: { title: '알림', desc: '계정 및 프로젝트 이벤트 전달 설정입니다.', icon: 'bell', message: '알림 전송 채널은 연결되지 않았습니다. 수신 설정은 이 프리뷰에서 저장되지 않습니다.' },
    privacy: { title: '개인정보', desc: '계정 데이터 처리와 보존 범위에 대한 정보입니다.', icon: 'lock', message: '삭제·내보내기 API가 제공되지 않아 실제 개인정보 작업을 실행할 수 없습니다.' },
  };
  const info = copy[page];
  return <>
    <PageHeading eyebrow="Account / settings" title={info.title} description={info.desc} />
    <Panel><EmptyState icon={info.icon} title="아직 연결된 설정 데이터가 없습니다" description={info.message} /></Panel>
    <div className="arw-section-title"><h2>현재 경계</h2><span>설계 제안 · 미구현</span></div>
    <Notice>{proposedMappingNote}</Notice>
  </>;
}

function PreferenceRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: () => void }) {
  return <div className="arw-key-row">
    <div><div className="arw-workspace-title">{title}</div><div className="arw-workspace-sub">{description}</div></div>
    <button type="button" className={`arw-toggle ${checked ? 'on' : ''}`} onClick={onChange} aria-pressed={checked}><span /></button>
  </div>;
}

function ActivityPage({ workspace }: { workspace: Workspace }) {
  return <>
    <PageHeading eyebrow={`Workspace / ${workspace.name}`} title="활동" description="현재 워크스페이스의 요약입니다. 실제 사용량이나 provider 상태는 연결 전까지 표시하지 않습니다." />
    {workspace.kind === 'local' && <Notice tone="violet"><strong>미리보기에서만 추가됨.</strong> 이 공간은 현재 브라우저 메모리에만 존재하며 서버 프로젝트는 생성되지 않았습니다.</Notice>}
    <div className="arw-metric-row">
      <div className="arw-metric"><span>Provider 비용</span><strong>확인 불가</strong><small>provider billing 미연동</small></div>
      <div className="arw-metric"><span>요청량</span><strong>—</strong><small>실제 요청 데이터 없음</small></div>
      <div className="arw-metric"><span>워크스페이스 상태</span><strong>미연동</strong><small>프로젝트 연결 확인 전</small></div>
    </div>
    <div className="arw-section-title"><h2>최근 활동</h2><span>현재 공간 한정</span></div>
    <Panel><EmptyState icon="activity" title="표시할 실제 활동이 없습니다" description={`${workspace.name}의 운영 데이터를 연결하지 않았습니다. 다른 워크스페이스의 키·세션·에셋은 이 페이지에 합산되지 않습니다.`} /></Panel>
    <div className="arw-section-title"><h2>연결 개요</h2><span>RoleplayX · 예시</span></div>
    <div className="arw-detail-grid">
      <div className="arw-detail-tile"><h3>인증 방식</h3><p>Base URL + server-side project API key</p></div>
      <div className="arw-detail-tile"><h3>최종 사용자 권한</h3><p>RoleplayX의 기존 로그인·멤버십 검사를 유지합니다. 프로젝트 키는 사용자 신원을 대체하지 않습니다.</p></div>
    </div>
  </>;
}

function ApiKeysPage({ workspace }: { workspace: Workspace }) {
  return <>
    <PageHeading eyebrow={`Workspace / ${workspace.name} / credentials`} title="API 키" description="키는 현재 프로젝트 공간에 한정되어야 하며 RoleplayX 서버의 secret store에서만 사용하세요." />
    <Notice tone="warning"><strong>어떤 키도 생성되거나 저장되지 않았습니다.</strong> 보이는 샘플 표시는 credential이 아니므로 요청에 사용할 수 없습니다.</Notice>
    <Panel>
      {workspace.sampleKey ? <>
        <div className="arw-key-row"><div><div className="arw-workspace-title">RoleplayX 개발 · 예시 키</div><div className="arw-workspace-sub">범위: 이 샘플 공간 · 실제 키 아님</div></div><span className="arw-pill violet">샘플 행</span></div>
        <div className="arw-key-row"><span className="arw-key-placeholder arw-mono">ar_sk_&lt;예시 · secret 아님&gt;</span><span className="arw-cell-muted">발급일·권한 없음</span></div>
        <div className="arw-key-row"><span className="arw-cell-muted">키 발급·회전·폐기</span><button className="arw-button" type="button" disabled title="키 관리 API가 연결되지 않았습니다."><KeyRound size={13} />미리보기에서 사용할 수 없음</button></div>
      </> : <EmptyState icon="key" title="이 공간에 표시할 키가 없습니다" description="이 샘플 워크스페이스에는 키가 설정되지 않았습니다. 다른 공간의 키를 가져오거나 공유하지 않습니다." />}
    </Panel>
    <p className="arw-footnote">실제 키는 인증된 Studio에서 발급해 한 번만 노출되는 secret으로 취급하세요. 화면·브라우저 저장소·클라이언트 코드에 넣지 마세요.</p>
    <div className="arw-section-title"><h2>RoleplayX 연결 규칙</h2><span>Server → AvatarRouter</span></div>
    <pre className="arw-code">{'AVATAR_ROUTER_BASE_URL=https://<avatarrouter-host>/api/v1\\nAVATAR_ROUTER_API_KEY=<server-side-project-key>'}</pre>
    <p className="arw-footnote">선택적 user delegation은 실제 통합 계약을 확인한 뒤 적용합니다. 유료 작업은 명시 동의가 필요하며 실패 후 자동 재시도하지 않습니다.</p>
  </>;
}

function UsagePage({ workspace }: { workspace: Workspace }) {
  return <>
    <PageHeading eyebrow={`Workspace / ${workspace.name} / usage`} title="사용량" description="요청량, 세션, 비용은 현재 워크스페이스의 실제 데이터가 연결된 경우에만 계산할 수 있습니다." />
    <Panel><EmptyState icon="chart" title="실제 사용량 데이터가 없습니다" description="요청 수, 세션 시간, 비용을 추정하지 않습니다. Provider billing은 미연동 · 확인 불가이며 0원으로 간주되지 않습니다." /></Panel>
    <div className="arw-section-title"><h2>확인 범위</h2><span>현재 공간만</span></div>
    <div className="arw-detail-grid">
      <div className="arw-detail-tile"><h3>AvatarRouter 요청</h3><p>실제 API 이벤트 연결 전에는 요청 수와 성공률을 표시하지 않습니다.</p></div>
      <div className="arw-detail-tile"><h3>Provider 청구</h3><p>Tavus·Anam 비용과 크레딧은 제공자 요금 및 실제 계정 확인이 필요합니다.</p></div>
    </div>
  </>;
}

function SessionsPage({ workspace }: { workspace: Workspace }) {
  return <>
    <PageHeading eyebrow={`Workspace / ${workspace.name} / sessions`} title="세션·로그" description="현재 공간의 세션 상태와 로그를 분리해 확인합니다. 운영자 복구 동작은 이 화면에 제공하지 않습니다." />
    {workspace.sampleSession && <Notice tone="warning"><strong>정리 확인이 필요한 세션 · 예시</strong> 운영자 확인 전까지 종료 여부가 불명확한 상태로 표시합니다. 이 화면은 복구·강제 해제·재시도 작업을 제공하지 않습니다.</Notice>}
    <Panel>
      {workspace.sampleSession ? <>
        <div className="arw-event"><span className="arw-event-icon"><Video size={14} /></span><div className="arw-event-body"><div className="arw-event-title">정리 확인 필요 · 샘플 세션</div><div className="arw-event-desc">이 공간에만 표시되는 예시 상태. 세션 ID와 provider 응답은 제공되지 않음.</div></div><span className="arw-pill warn">운영자 확인</span></div>
        <div className="arw-key-row"><span className="arw-cell-muted">복구 및 reconciliation 정보</span><span className="arw-cell-muted">운영자 전용 · 미노출</span></div>
      </> : <EmptyState icon="file" title="이 공간에는 표시할 세션이 없습니다" description="다른 워크스페이스의 세션 상태를 섞지 않습니다. 새 라이브 세션도 미리보기에서 시작하지 않습니다." />}
    </Panel>
    <p className="arw-footnote">종료 여부는 terminal 상태와 cleanupPending=false가 확인되어야 합니다. 확인되지 않은 세션에 자동 재시도를 수행하지 않습니다.</p>
  </>;
}

function AssetsPage({ workspace }: { workspace: Workspace }) {
  return <>
    <PageHeading eyebrow={`Workspace / ${workspace.name} / assets`} title="아바타·에셋" description="에셋 목록은 현재 프로젝트 공간 범위입니다. 개인 Studio 에셋과 자동 공유하지 않습니다." />
    <Panel>{workspace.assets.length ? <>
      {workspace.assets.map((asset, index) => <div className="arw-key-row" key={`${workspace.id}-${index}`}><div className="arw-name-cell"><WorkspaceMark kind={workspace.kind} /><div><div className="arw-workspace-title">{asset}</div><div className="arw-workspace-sub">아바타 식별 참조 · 실제 업로드 아님</div></div></div><span className="arw-pill">예시 데이터</span></div>)}
      <div className="arw-key-row"><span className="arw-cell-muted">업로드 및 provider 프로비저닝</span><button className="arw-button" type="button" disabled><Plus size={13} />미리보기에서 사용할 수 없음</button></div>
    </> : <EmptyState icon="image" title="이 공간에는 에셋이 없습니다" description="샘플 에셋을 다른 프로젝트에서 가져오지 않습니다. 업로드와 provider 프로비저닝은 수행되지 않습니다." />}</Panel>
    <p className="arw-footnote">Tavus 커스텀 이미지 프로비저닝은 실제 권한과 비용 조건을 확인해야 합니다. 이 화면은 파일을 업로드하거나 provider를 호출하지 않습니다.</p>
  </>;
}

function LimitsPage({ workspace }: { workspace: Workspace }) {
  return <>
    <PageHeading eyebrow={`Workspace / ${workspace.name} / limits`} title="사용 한도" description="실제 프로젝트에 적용된 제한을 읽어야 하는 화면입니다. 현재 한도를 임의로 만들거나 적용하지 않습니다." />
    <Panel><EmptyState icon="shield" title="적용된 한도를 확인할 수 없습니다" description="요청량 또는 비용 제한 API가 연결되지 않았습니다. Provider 요금도 미연동 · 확인 불가이며, 사용 한도 초과 여부를 판단할 수 없습니다." /></Panel>
    <div className="arw-section-title"><h2>정책 설계 제안</h2><span>실제 적용 아님</span></div>
    <div className="arw-detail-grid">
      <div className="arw-detail-tile"><h3>요청 제한</h3><p>프로젝트별 제한 값을 실제 서버 정책과 함께 노출하는 것이 제안됩니다.</p></div>
      <div className="arw-detail-tile"><h3>유료 호출 동의</h3><p>세션 생성 전에 명시적인 비용 확인을 받고 자동 재시도하지 않습니다.</p></div>
    </div>
  </>;
}

function SettingsPage({ workspace, onSave }: { workspace: Workspace; onSave: (name: string, description: string) => void }) {
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description);
  const [saved, setSaved] = useState(false);
  return <>
    <PageHeading eyebrow={`Workspace / ${workspace.name} / settings`} title="설정" description="이 폼은 브라우저의 미리보기 상태만 바꿉니다. 실제 프로젝트 이름이나 설정은 변경하지 않습니다." />
    <Panel>
      <form className="arw-settings-form" onSubmit={e => { e.preventDefault(); onSave(name, description); setSaved(true); }}>
        <div className="arw-form-grid">
          <div className="arw-field"><label htmlFor="workspace-name">표시 이름</label><input id="workspace-name" value={name} maxLength={48} onChange={e => { setName(e.target.value); setSaved(false); }} /><span className="arw-form-help">로컬 미리보기에서만 변경됩니다. 서버 프로젝트 이름에 영향을 주지 않습니다.</span></div>
          <div className="arw-field"><label htmlFor="workspace-description">설명</label><textarea id="workspace-description" value={description} maxLength={160} onChange={e => { setDescription(e.target.value); setSaved(false); }} /></div>
          <div className="arw-form-help">범위: {workspace.kind === 'local' ? '이 기기에서만 생성한 공간' : '샘플 공간'} · ID/비밀 값 표시 없음</div>
        </div>
        <div className="arw-form-footer">{saved && <span className="arw-save-status"><Check size={13} />미리보기에서만 변경됨</span>}<button className="arw-button primary" type="submit" disabled={!name.trim()}>미리보기에서 저장</button></div>
      </form>
    </Panel>
    <div className="arw-section-title"><h2>범위와 권한</h2><span>실제 변경 없음</span></div>
    <div className="arw-detail-grid">
      <div className="arw-detail-tile"><h3>프로젝트 연결</h3><p>워크스페이스와 기존 API-key 프로젝트를 연결하는 기능은 제안 상태입니다. 프로젝트 생성·이름 변경·이관은 구현되지 않았습니다.</p></div>
      <div className="arw-detail-tile"><h3>멤버·역할</h3><p>멤버 권한은 확인된 API가 없습니다. 소유자 부여나 자기 권한 상승 동작을 제공하지 않습니다.</p></div>
    </div>
  </>;
}

function GlobalArea({ page, onPage }: { page: PublicPage; onPage: (page: PublicPage) => void }) {
  const titles: Record<PublicPage, string> = { avatars: '아바타 카탈로그', playground: 'Playground', docs: '문서' };
  return <main className="arw-global-area">
    <div className="arw-page">
      <PageHeading eyebrow={`AvatarRouter / ${page}`} title={titles[page]} description="계정 관리와 분리된 공개 영역 미리보기입니다. 외부 서비스나 provider를 호출하지 않습니다." />
      <div className="arw-global-tabs" role="tablist" aria-label="공개 영역">
        {(['avatars', 'playground', 'docs'] as const).map(item => <button role="tab" aria-selected={page === item} key={item} className={page === item ? 'active' : ''} onClick={() => onPage(item)}>{item === 'avatars' ? '아바타' : item === 'playground' ? 'Playground' : '문서'}</button>)}
      </div>
      {page === 'avatars' && <>
        <Notice>아래는 기존 AvatarRouter 카탈로그 구성의 미리보기입니다. 실제 제공 가능 여부, 브라우저 재생, provider 가격을 여기서 검증하지 않습니다.</Notice>
        <div className="arw-card-list">
          <div className="arw-detail-tile"><h3>Tavus · Lucy - Home</h3><p>Live avatar · 식별자 예시 <span className="arw-mono">tavus-stock-lucy</span><br />가격: 제공자 확인 필요</p></div>
          <div className="arw-detail-tile"><h3>Anam stock · 예시</h3><p>카탈로그 구조용 샘플 · 실제 제공 여부 미확인<br />이미지 프로비저닝 미지원</p></div>
          <div className="arw-detail-tile"><h3>커스텀 아바타 · 예시</h3><p>Tavus 이미지 프로비저닝 유형 · 업로드와 생성은 실행하지 않음</p></div>
        </div>
      </>}
      {page === 'playground' && <>
        <Notice tone="warning"><strong>라이브 세션을 실행하지 않습니다.</strong> provider 비용이 발생할 수 있으므로 명시적인 비용 확인 없이는 생성하면 안 됩니다.</Notice>
        <Panel><div className="arw-key-row"><div><div className="arw-workspace-title">Base URL</div><div className="arw-workspace-sub arw-mono">https://&lt;avatarrouter-host&gt;/api/v1</div></div><span className="arw-pill">형식 예시</span></div>
          <div className="arw-key-row"><div><div className="arw-workspace-title">Project API key</div><div className="arw-workspace-sub">RoleplayX 서버에서만 사용하는 credential</div></div><span className="arw-key-placeholder arw-mono">ar_sk_&lt;placeholder&gt;</span></div>
          <div className="arw-key-row"><div><div className="arw-workspace-title">연결 테스트</div><div className="arw-workspace-sub">무료 인증 확인은 실제 연결 환경에서 수행하세요.</div></div><button type="button" className="arw-button" disabled>미리보기에서는 실행 안 함</button></div></Panel>
        <div className="arw-section-title"><h2>권장 확인 순서</h2><span>유료 작업 없음</span></div>
        <pre className="arw-code">{'GET /auth/check\\nAuthorization: Bearer $AVATAR_ROUTER_API_KEY\\n\\n서버에서 인증을 확인한 뒤, 유료 세션은 별도 동의 후 시작합니다.'}</pre>
      </>}
      {page === 'docs' && <>
        <div className="arw-detail-grid">
          <div className="arw-detail-tile"><h3>인증 · Base URL + project API key</h3><p>API key는 프로젝트를 인증합니다. RoleplayX의 기존 로그인과 멤버십 검사는 백엔드에서 유지합니다.</p></div>
          <div className="arw-detail-tile"><h3>서버 측 호출</h3><p>비밀 키를 브라우저, 응답, URL, 로그, 소스 저장소에 노출하지 마세요.</p></div>
          <div className="arw-detail-tile"><h3>비용 동의</h3><p>라이브 생성은 provider 비용이 발생할 수 있습니다. 사용자 동의 없이 실행하지 않습니다.</p></div>
          <div className="arw-detail-tile"><h3>재시도와 정리</h3><p>상태가 불명확한 작업은 자동 재시도하지 않고 운영자가 확인해야 합니다.</p></div>
        </div>
      </>}
    </div>
  </main>;
}

function CreateWorkspaceModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, description: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return <Modal title="새 워크스페이스" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), description.trim()); }}>
      <div className="arw-form-grid">
        <div className="arw-field"><label htmlFor="new-workspace-name">이름</label><input autoFocus id="new-workspace-name" value={name} maxLength={48} onChange={e => setName(e.target.value)} placeholder="예: RoleplayX · 스테이징" required /></div>
        <div className="arw-field"><label htmlFor="new-workspace-description">설명</label><textarea id="new-workspace-description" value={description} maxLength={160} onChange={e => setDescription(e.target.value)} placeholder="이 공간을 구분하는 설명" /></div>
      </div>
      <div className="arw-notice violet" style={{ marginTop: 14, marginBottom: 0 }}><span className="arw-notice-mark">i</span><div>미리보기에서만 추가됨. 서버 프로젝트나 실제 워크스페이스는 생성되지 않습니다.</div></div>
      <div className="arw-modal-actions"><button type="button" className="arw-button" onClick={onClose}>취소</button><button type="submit" className="arw-button primary" disabled={!name.trim()}><Plus size={13} />로컬 공간 추가</button></div>
    </form>
  </Modal>;
}

export function WorkspaceConsole() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initialWorkspaces);
  const [accountPage, setAccountPage] = useState<AccountPage>('workspaces');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>('activity');
  const [publicPage, setPublicPage] = useState<PublicPage | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [preferences, setPreferences] = useState<LocalPreference>({ compact: false, notices: true, confirmCost: true });
  const selectedWorkspace = workspaces.find(item => item.id === workspaceId) ?? null;

  const createWorkspace = (name: string, description: string) => {
    const created: Workspace = {
      id: `local-${Date.now()}-${workspaces.length}`,
      name,
      description: description || '이 기기에서 추가된 로컬 미리보기 공간',
      kind: 'local',
      sampleKey: false,
      sampleSession: false,
      assets: [],
    };
    setWorkspaces(current => [...current, created]);
    setWorkspaceId(created.id);
    setWorkspacePage('activity');
    setAccountPage('workspaces');
    setPublicPage(null);
    setCreateOpen(false);
  };

  const openAccountPage = (page: AccountPage) => {
    setWorkspaceId(null);
    setAccountPage(page);
    setPublicPage(null);
  };

  const openWorkspace = (id: string) => {
    setWorkspaceId(id);
    setWorkspacePage('activity');
    setPublicPage(null);
  };

  const openPublicPage = (page: string) => {
    if (page === 'avatars' || page === 'playground' || page === 'docs') setPublicPage(page);
    setMobileOpen(false);
  };

  const saveWorkspace = (name: string, description: string) => {
    if (!selectedWorkspace) return;
    setWorkspaces(current => current.map(item => item.id === selectedWorkspace.id ? { ...item, name: name.trim(), description: description.trim() } : item));
  };

  const mainPage = () => {
    if (selectedWorkspace) {
      switch (workspacePage) {
        case 'activity': return <ActivityPage workspace={selectedWorkspace} />;
        case 'api-keys': return <ApiKeysPage workspace={selectedWorkspace} />;
        case 'usage': return <UsagePage workspace={selectedWorkspace} />;
        case 'sessions': return <SessionsPage workspace={selectedWorkspace} />;
        case 'assets': return <AssetsPage workspace={selectedWorkspace} />;
        case 'limits': return <LimitsPage workspace={selectedWorkspace} />;
        case 'settings': return <SettingsPage key={selectedWorkspace.id} workspace={selectedWorkspace} onSave={saveWorkspace} />;
      }
    }
    if (accountPage === 'workspaces') return <WorkspaceList workspaces={workspaces} filter={filter} onFilter={setFilter} onOpen={openWorkspace} onCreate={() => setCreateOpen(true)} />;
    return <AccountHomePage page={accountPage as Exclude<AccountPage, 'workspaces'>} preferences={preferences} onPreference={key => setPreferences(current => ({ ...current, [key]: !current[key] }))} />;
  };

  return <div className="ar-workspaces">
    <PreviewBadge />
    <TopBar
      inWorkspace={Boolean(selectedWorkspace)}
      workspaces={workspaces}
      workspaceId={workspaceId}
      onWorkspaceChange={openWorkspace}
      onBack={() => { openAccountPage('workspaces'); setMobileOpen(false); }}
      onGlobal={openPublicPage}
      mobileOpen={mobileOpen}
      setMobileOpen={setMobileOpen}
      search={filter}
      onSearch={value => {
        setFilter(value);
        if (value.trim()) {
          setWorkspaceId(null);
          setAccountPage('workspaces');
          setPublicPage(null);
        }
      }}
    />
    {publicPage ? <GlobalArea page={publicPage} onPage={setPublicPage} /> : <div className="arw-shell">
      {selectedWorkspace
        ? <WorkspaceSidebar items={workspaceNavigation} active={workspacePage} onSelect={setWorkspacePage} onBack={() => openAccountPage('workspaces')} open={mobileOpen} onClose={() => setMobileOpen(false)} />
        : <AccountSidebar items={accountNavigation} active={accountPage} onSelect={openAccountPage} open={mobileOpen} onClose={() => setMobileOpen(false)} />}
      {mobileOpen && <button className="arw-mobile-scrim" type="button" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} />}
      <main className="arw-main"><div className="arw-page">{mainPage()}</div></main>
    </div>}
    {createOpen && <CreateWorkspaceModal onClose={() => setCreateOpen(false)} onCreate={createWorkspace} />}
  </div>;
}

export default WorkspaceConsole;
