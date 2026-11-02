import './_group.css';
import './_redesign.css';
import { useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp,
  Code2, Copy, Filter, Image, KeyRound, LayoutGrid, List, LockKeyhole,
  Menu, MessageSquareText, Play, Search, ShieldCheck, Sparkles, Video, Wallet,
  AlertTriangle, X,
} from 'lucide-react';

type Page = 'catalog' | 'detail' | 'playground' | 'docs' | 'pricing' | 'keys' | 'usage' | 'sessions' | 'assets';
type Avatar = {
  id: string;
  name: string;
  provider: string;
  providerKind: 'tavus' | 'anam' | 'custom';
  category: 'Stock' | 'Custom';
  capability: string;
  price: string;
  state: string;
  description: string;
};

const avatars: Avatar[] = [
  { id: 'tavus-stock-lucy', name: 'Lucy - Home', provider: 'Tavus', providerKind: 'tavus', category: 'Stock', capability: 'Live avatar', price: '제공자 요금 확인', state: '브라우저 재생 미검증', description: 'RoleplayX 연동 테스트에 사용할 수 있는 Tavus 기본 아바타입니다. 이미지 업로드나 프로비저닝 없이 식별자로 선택합니다.' },
  { id: 'anam-stock-example', name: 'Anam stock · 예시', provider: 'Anam', providerKind: 'anam', category: 'Stock', capability: 'Live avatar', price: '요금 미확인', state: '예시 항목', description: '카탈로그 구조를 설명하기 위한 Anam stock 예시 항목입니다. 실제 제공 여부와 재생 동작은 이 미리보기에서 확인하지 않습니다.' },
  { id: 'custom-tavus-sample', name: '커스텀 아바타 · 예시', provider: 'Tavus', providerKind: 'custom', category: 'Custom', capability: 'Image provisioning', price: '제공자 요금 확인', state: '준비 대기', description: '이미지 프로비저닝이 가능한 Tavus 커스텀 항목 예시입니다. 이 화면은 샘플이며 업로드나 생성을 실행하지 않습니다.' },
];

const topItems: { title: string; page: Page }[] = [
  { title: '아바타', page: 'catalog' }, { title: 'Playground', page: 'playground' },
  { title: '문서', page: 'docs' }, { title: '요금', page: 'pricing' },
];
const accountItems: { title: string; page: Page; icon: typeof KeyRound }[] = [
  { title: 'API 키', page: 'keys', icon: KeyRound }, { title: '사용량', page: 'usage', icon: Wallet },
  { title: '세션', page: 'sessions', icon: Video }, { title: '내 에셋', page: 'assets', icon: Image },
];

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><span>ar</span></span>;
}

function Header({ page, go, search, setSearch }: { page: Page; go: (p: Page) => void; search: string; setSearch: (s: string) => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const activeTop = page === 'detail' ? 'catalog' : page;
  const links = (mobile = false) => topItems.map(item => (
    <button key={item.page} className={`nav-button ${activeTop === item.page ? 'active' : ''}`} onClick={() => { go(item.page); setMobileOpen(false); }}>
      {item.title}
    </button>
  ));
  return <>
    <div className="preview-mark"><i /> 디자인 미리보기 · 예시 데이터 <span className="hide-mobile">/ 실제 연결·인증·저장 없음</span></div>
    <header className="topbar">
      <div className="top-inner">
        <button className="brand" onClick={() => go('catalog')} aria-label="AvatarRouter 홈"><Mark />AvatarRouter</button>
        <nav className="main-nav" aria-label="주요 메뉴">{links()}</nav>
        <label className="top-search">
          <Search size={15} />
          <input value={search} onChange={e => { setSearch(e.target.value); if (page !== 'catalog') go('catalog'); }} placeholder="아바타 검색..." aria-label="아바타 검색" />
        </label>
        <div style={{ position: 'relative' }}>
          <button className="account" onClick={() => setAccountOpen(v => !v)} aria-expanded={accountOpen}>
            <span className="account-dot" /> 콘솔 <ChevronDown size={13} />
          </button>
          {accountOpen && <div style={{ position: 'absolute', right: 0, top: 42, zIndex: 30, width: 170, background: 'white', border: '1px solid var(--line)', borderRadius: 8, padding: 5, boxShadow: '0 8px 25px #2b233012' }}>
            {accountItems.map(({ title, page: dest, icon: Icon }) => <button key={dest} onClick={() => { go(dest); setAccountOpen(false); }} className="filter-option"><Icon size={14} />{title}</button>)}
          </div>}
        </div>
        <button className="mobile-menu" onClick={() => setMobileOpen(v => !v)} aria-label="메뉴 열기">{mobileOpen ? <X size={17} /> : <Menu size={17} />}</button>
      </div>
      {mobileOpen && <nav className="mobile-nav-panel" aria-label="모바일 메뉴">{links(true)}{accountItems.map(({title,page:dest}) => <button key={dest} className={`nav-button ${page === dest ? 'active' : ''}`} onClick={() => {go(dest);setMobileOpen(false);}}>{title}</button>)}</nav>}
    </header>
  </>;
}

function FilterPanel({ provider, setProvider, capability, setCapability, onlyStock, setOnlyStock }: {
  provider: string; setProvider: (v: string) => void; capability: string; setCapability: (v: string) => void; onlyStock: boolean; setOnlyStock: (v: boolean) => void;
}) {
  return <aside className="filters">
    <div className="filter-heading"><span>필터</span><Filter size={14} color="#938d9b" /></div>
    <div className="filter-section">
      <div className="filter-title">Provider</div>
      {['모두', 'Tavus', 'Anam'].map(item => <label className="filter-option" key={item}>
        <input type="radio" name="provider" checked={provider === item} onChange={() => setProvider(item)} />{item}
        <span className="filter-count">{item === '모두' ? '3' : item === 'Tavus' ? '2' : '1'}</span>
      </label>)}
    </div>
    <div className="filter-section">
      <div className="filter-title">Capability</div>
      {['모두', 'Live avatar', 'Image provisioning'].map(item => <label className="filter-option" key={item}>
        <input type="radio" name="capability" checked={capability === item} onChange={() => setCapability(item)} />{item}
      </label>)}
    </div>
    <div className="filter-section">
      <div className="filter-title">Pricing</div>
      <label className="filter-option"><input type="checkbox" checked={onlyStock} onChange={e => setOnlyStock(e.target.checked)} />Stock 아바타만</label>
      <div style={{ color: '#9a95a1', fontSize: 10, lineHeight: 1.5, paddingLeft: 22 }}>가격은 제공자 확인 전까지 표시하지 않습니다.</div>
    </div>
  </aside>;
}

function AvatarMark({ item }: { item: Avatar }) {
  const Icon = item.providerKind === 'custom' ? Image : item.providerKind === 'anam' ? Sparkles : Video;
  return <span className={`avatar-glyph ${item.providerKind}`}><Icon size={17} strokeWidth={1.7} /></span>;
}

function Catalog({ search, onSelect }: { search: string; onSelect: (item: Avatar) => void }) {
  const [provider, setProvider] = useState('모두');
  const [capability, setCapability] = useState('모두');
  const [onlyStock, setOnlyStock] = useState(false);
  const [tab, setTab] = useState('모두');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState('추천순');
  const filtered = useMemo(() => avatars.filter(item => {
    const query = search.trim().toLowerCase();
    return (!query || `${item.name} ${item.provider} ${item.id} ${item.capability}`.toLowerCase().includes(query))
      && (provider === '모두' || item.provider === provider)
      && (capability === '모두' || item.capability === capability)
      && (!onlyStock || item.category === 'Stock')
      && (tab === '모두' || item.category === tab);
  }), [search, provider, capability, onlyStock, tab]);
  const rows = sort === '이름순' ? [...filtered].sort((a,b) => a.name.localeCompare(b.name, 'ko')) : filtered;
  return <div className="page">
    <div className="page-head">
      <div><div className="eyebrow">Avatar catalog / 01</div><h1>아바타를 찾아보세요</h1><p className="lede">한 개의 Base URL과 프로젝트 API key로 RoleplayX에 연결하세요. 아바타부터 확인하고 필요한 통합 정보를 이어서 볼 수 있습니다.</p></div>
    </div>
    <div className="catalog-layout">
      <FilterPanel provider={provider} setProvider={setProvider} capability={capability} setCapability={setCapability} onlyStock={onlyStock} setOnlyStock={setOnlyStock} />
      <section className="catalog-main">
        <div className="catalog-intro">
          <div><h2>사용 가능한 아바타</h2><p>제공자 기능과 가격 정보는 확인 가능한 범위만 표시합니다.</p></div>
          <div className="view-switch" role="group" aria-label="보기 방식">
            <button className={`icon-switch ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} aria-label="목록 보기"><List size={15} /></button>
            <button className={`icon-switch ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} aria-label="카드 보기"><LayoutGrid size={15} /></button>
          </div>
        </div>
        <div className="tabs">{['모두', 'Stock', 'Custom'].map(label => <button key={label} className={`tab ${tab === label ? 'active' : ''}`} onClick={() => setTab(label)}>{label === '모두' ? '전체' : label}</button>)}</div>
        <div className="catalog-toolbar"><span>{rows.length}개 항목</span><label>정렬 <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}><option>추천순</option><option>이름순</option></select></label></div>
        {rows.length ? <div className={view === 'grid' ? 'catalog-cards' : ''}>
          <table className="catalog-table">
            <thead><tr><th>아바타</th><th>Provider</th><th>Capability</th><th>상태</th><th>Pricing</th><th /></tr></thead>
            <tbody>{rows.map(item => <tr key={item.id} onClick={() => onSelect(item)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelect(item)}>
              <td><div className="avatar-title"><AvatarMark item={item} /><div><div className="avatar-name">{item.name}</div><div className="avatar-sub mono">{item.id}</div></div></div></td>
              <td><span className="provider-tag">{item.provider}{item.providerKind === 'custom' ? ' · 커스텀' : ''}</span></td>
              <td><span className="capability"><i className={`cap-dot ${item.providerKind === 'anam' ? 'pending' : ''}`} />{item.capability}</span></td>
              <td className="price-note">{item.state}</td>
              <td className="price-note">{item.price}</td>
              <td><ArrowRight size={15} className="row-arrow" /></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="empty-state"><div className="empty-icon"><Search size={18} /></div><h3>조건에 맞는 아바타가 없습니다</h3><p style={{ fontSize: 12, margin: '6px 0 14px' }}>검색어 또는 필터를 조정해 다시 확인해 보세요.</p><button className="btn" onClick={() => { setProvider('모두'); setCapability('모두'); setOnlyStock(false); setTab('모두'); }}>필터 초기화</button></div>}
        <div className="footer-note">가격·가용성은 제공자 확인이 필요합니다. 이 카탈로그는 디자인 미리보기의 예시 데이터이며 라이브 연결을 검증하지 않습니다.</div>
      </section>
    </div>
  </div>;
}

function Detail({ item, back, goPlay }: { item: Avatar; back: () => void; goPlay: () => void }) {
  return <div className="page">
    <button className="detail-back" onClick={back}><ArrowLeft size={14} /> 아바타 카탈로그</button>
    <div className="detail-hero">
      <section className="detail-card">
        <div className="detail-title"><AvatarMark item={item} /><div><h1>{item.name}</h1><div className="detail-id">{item.id}</div></div></div>
        <p className="detail-blurb">{item.description}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 21 }}><span className="provider-tag">{item.provider}</span><span className="provider-tag">{item.category}</span><span className="provider-tag">{item.capability}</span></div>
        <div className="facts">
          <div><div className="fact-label">Provider</div><div className="fact-value">{item.provider}</div></div>
          <div><div className="fact-label">Pricing</div><div className="fact-value">{item.price}</div></div>
          <div><div className="fact-label">Playback</div><div className="fact-value" style={{ color: '#9b7440' }}>미검증</div></div>
        </div>
      </section>
      <aside className="detail-side">
        <div className="eyebrow">다음 단계</div><h2 style={{ marginTop: 10 }}>연동 전에 확인할 것</h2>
        <p>먼저 API key를 준비하고, 무료 <span className="mono">/auth/check</span>로 인증과 권한을 확인하세요. 이 동작은 provider session을 만들지 않습니다.</p>
        <button className="btn primary" onClick={goPlay}>Playground에서 살펴보기 <ArrowRight size={14} /></button>
      </aside>
    </div>
    <div className="section-block"><h2>통합 정보</h2><div className="split">
      <div className="info-tile"><h3>식별자</h3><p>요청 본문에서 Provider와 Avatar ID를 명시합니다. 기본 Tavus 항목의 ID는 실제 제품 식별자입니다.</p><div className="codebox" style={{ marginTop: 12 }}>{`{\n  "providerId": "${item.providerKind === 'anam' ? 'anam' : 'tavus'}",\n  "avatarId": "${item.id}"\n}`}</div></div>
      <div className="info-tile"><h3>기능 범위</h3><p>{item.providerKind === 'custom' ? 'Tavus는 이미지 기반 아바타 프로비저닝을 지원합니다. 이 샘플은 대기 상태이며 브라우저 재생은 검증되지 않았습니다.' : item.providerKind === 'anam' ? 'Anam 항목은 문서 구조를 보여주는 예시입니다. 이미지 프로비저닝을 지원하지 않는 provider로 구분합니다.' : 'Tavus stock 아바타는 이미지 프로비저닝 없이 ID로 선택합니다. 브라우저 재생은 이 미리보기에서 확인하지 않았습니다.'}</p></div>
    </div></div>
  </div>;
}

function CleanupBanner() {
  return <div className="cleanup"><AlertTriangle size={15} /><div><strong>정리가 확인되지 않은 이전 샘플 세션</strong><br />운영자 확인이 필요합니다. 이 디자인은 세션을 정리하거나 자동 재시도하지 않습니다. 상태 확인 전 새 유료 세션을 시작하지 마세요.</div></div>;
}

function Playground({ initialAvatar }: { initialAvatar: Avatar }) {
  const [selected, setSelected] = useState(initialAvatar.id);
  const providerId = avatars.find(item => item.id === selected)?.providerKind === 'anam' ? 'anam' : 'tavus';
  return <div className="page">
    <div className="page-head"><div><div className="eyebrow">Playground / preview only</div><h1>연결 전, 요청을 살펴보세요</h1><p className="lede">UI와 요청 형태를 미리 확인하는 화면입니다. 실제 provider 연결이나 아바타 재생은 수행하지 않습니다.</p></div></div>
    <CleanupBanner />
    <div className="play-layout">
      <div className="play-stage"><div className="stage-orbit"><div className="stage-core"><Video size={28} /></div></div><div className="stage-label">브라우저 재생 미검증 · 미리보기 플레이스홀더</div></div>
      <aside className="surface control-panel">
        <div className="eyebrow">요청 설정</div>
        <div className="control-row"><label htmlFor="avatar-select">Avatar</label><select id="avatar-select" className="control-select" value={selected} onChange={e => setSelected(e.target.value)}>{avatars.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="control-row"><label>Base URL</label><div className="mono" style={{ border: '1px solid var(--line)', borderRadius: 7, padding: 10, fontSize: 10, color: '#797482' }}>https://&lt;avatarrouter-host&gt;/api/v1</div></div>
        <div className="control-row"><label>API key</label><div className="mono" style={{ border: '1px solid var(--line)', borderRadius: 7, padding: 10, fontSize: 10, color: '#a19ba9' }}>ar_sk_&lt;예시_키_미저장&gt;</div></div>
        <button className="btn primary disabled" disabled title="미리보기에서는 실제 연결을 실행할 수 없습니다."><Play size={14} />실제 연결 시작</button>
        <p className="note">미리보기에서는 연결이 실행되지 않습니다. 라이브 세션은 provider 요금이 발생할 수 있으므로 별도 확인이 필요합니다.</p>
      </aside>
    </div>
    <div className="section-block"><h2>요청 예시</h2><div className="codebox">{`POST /sessions\nAuthorization: Bearer $AVATAR_ROUTER_API_KEY\nContent-Type: application/json\n\n{\n  "providerId": "${providerId}",\n  "avatarId": "${selected}",\n  "mode": "live",\n  "costConfirmed": true\n}`}</div></div>
  </div>;
}

function Setup({ openModal, goDocs }: { openModal: () => void; goDocs: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyLabel = () => {
    void navigator.clipboard?.writeText('AVATAR_ROUTER_BASE_URL=https://<avatarrouter-service-host>/api/v1\nAVATAR_ROUTER_API_KEY=ar_sk_<미리보기용_예시_키>')
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })
      .catch(() => setCopied(false));
  };
  return <div className="page">
    <div className="page-head"><div><div className="eyebrow">Developer console / API keys</div><h1>RoleplayX 연결 설정</h1><p className="lede">필요한 값은 두 가지입니다. 프로젝트 API key는 RoleplayX의 서버 비밀 저장소에만 두고, 브라우저에 노출하지 마세요.</p></div><button className="btn primary" onClick={openModal}><KeyRound size={14} />API 키 만들기</button></div>
    <div className="steps"><div className="step active"><span className="step-num">01</span>프로젝트 키</div><div className="step active"><span className="step-num">02</span>RoleplayX 설정</div><div className="step"><span className="step-num">03</span>무료 연결 확인</div></div>
    <div className="setup-grid">
      <div>
        <section className="surface setup-panel">
          <h2>1. Base URL과 API key</h2><p>아래 key는 형식만 보여주는 명시적 placeholder입니다. 실제 키가 아니며 생성·저장되지 않습니다.</p>
          <div className="codebox">{`AVATAR_ROUTER_BASE_URL=https://<avatarrouter-service-host>/api/v1\nAVATAR_ROUTER_API_KEY=ar_sk_<미리보기용_예시_키>`}</div>
          <button className="btn" style={{ marginTop: 12 }} onClick={copyLabel}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '예시 형식 복사됨' : '예시 형식 복사'}</button>
          <div className="callout" style={{ marginTop: 17 }}>API key는 프로젝트를 인증합니다. RoleplayX의 기존 로그인·멤버십 검사는 그대로 서버에서 수행하세요. 이 화면은 인증을 실행하지 않습니다.</div>
        </section>
        <section className="surface setup-panel section-block">
          <h2>2. 유료 호출 없이 인증 확인</h2><p><span className="mono">/auth/check</span>는 provider conversation을 만들지 않고 키 인증과 프로젝트 권한만 확인합니다.</p>
          <div className="codebox">{`curl --fail-with-body --silent --show-error \\\\\n  -H "Authorization: Bearer $AVATAR_ROUTER_API_KEY" \\\\\n  "$AVATAR_ROUTER_BASE_URL/auth/check"`}</div>
          <p className="note">성공 응답의 의미는 실제 환경에서 확인하세요. 이 디자인 미리보기는 요청하지 않으며 성공을 표시하지 않습니다.</p>
        </section>
        <section className="surface setup-panel section-block"><h2>3. 서버에서만 호출</h2><p>브라우저 응답, URL, 로그 또는 소스 저장소에 API key를 포함하지 마세요.</p><div className="codebox">{`const response = await fetch(\n  \`\${process.env.AVATAR_ROUTER_BASE_URL}/auth/check\`,\n  { headers: { Authorization: \`Bearer \${process.env.AVATAR_ROUTER_API_KEY}\` } },\n);\nif (!response.ok) throw new Error("AvatarRouter rejected the connection");\nreturn response.json();`}</div></section>
      </div>
      <aside className="surface setup-aside">
        <div className="eyebrow">권장 권한</div><h3 style={{ marginTop: 8 }}>필요한 범위만 선택</h3><p style={{ fontSize: 11 }}>목록 조회와 커스텀 에셋 작업에 해당하는 scope입니다.</p>
        <ul className="checklist"><li><Check size={14} /><span><b className="mono">assets:read</b><br />프로젝트 에셋 조회</span></li><li><Check size={14} /><span><b className="mono">assets:write</b><br />에셋 등록·프로비저닝</span></li><li><LockKeyhole size={14} /><span>세션 권한은 사용 목적에 따라 별도 선택</span></li></ul>
        <div style={{ borderTop: '1px solid #efedf1', marginTop: 17, paddingTop: 15 }}><h3 style={{ fontSize: 12 }}>기존 키 권한 수정</h3><p style={{ fontSize: 11 }}>새 프로젝트를 만들기보다 기존 프로젝트의 권한 목록을 확인하세요. 키 값과 프로젝트를 유지할 수 있습니다.</p><button className="btn" onClick={goDocs}>문서에서 권한 안내 보기 <ArrowRight size={13} /></button></div>
      </aside>
    </div>
  </div>;
}

function Docs() {
  const [section, setSection] = useState('quickstart');
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Documentation / API 0.5</div><h1>문서</h1><p className="lede">RoleplayX는 기존 로그인과 대화 흐름을 유지하고, 백엔드에서 AvatarRouter를 호출합니다.</p></div></div>
    <div className="tabs">{[['quickstart','Quickstart'],['auth','Authentication'],['avatars','Avatars'],['sessions','Sessions']].map(([key,label]) => <button key={key} className={`tab ${section === key ? 'active' : ''}`} onClick={() => setSection(key)}>{label}</button>)}</div>
    <div className="setup-grid section-block"><div className="surface setup-panel">
      {section === 'quickstart' && <><h2>Base URL + project API key</h2><p>OpenRouter 방식의 프로젝트 credential 설정입니다. OpenAI chat/completions 호환 API를 의미하지 않습니다.</p><div className="codebox">{`AVATAR_ROUTER_BASE_URL=https://<avatarrouter-service-host>/api/v1\nAVATAR_ROUTER_API_KEY=<one-time project key>`}</div><h3 style={{ marginTop: 22 }}>먼저 무료 인증 확인</h3><div className="codebox" style={{ marginTop: 10 }}>{`GET /auth/check\nAuthorization: Bearer $AVATAR_ROUTER_API_KEY`}</div></>}
      {section === 'auth' && <><h2>프로젝트 키 보안</h2><p>키는 프로젝트를 인증하며 최종 사용자의 신원을 대체하지 않습니다. RoleplayX는 기존 세션·조직 권한을 확인해야 합니다.</p><div className="callout">키 발급은 이 미리보기에서 수행되지 않습니다. 실제 키는 한 번만 표시되는 secret으로 취급하세요.</div></>}
      {section === 'avatars' && <><h2>아바타 선택</h2><p>기본 Tavus stock 선택은 다음 식별자를 사용합니다.</p><div className="codebox">{`{ "providerId": "tavus", "avatarId": "tavus-stock-lucy" }`}</div><p>이미지 프로비저닝은 Tavus 커스텀 기능입니다. Anam은 이미지 프로비저닝을 지원하지 않습니다.</p></>}
      {section === 'sessions' && <><h2>세션 생성은 유료 작업일 수 있습니다</h2><p>명시적인 비용 확인 없이 라이브 세션을 생성하지 마세요. 생성 응답이 queued 상태여도 브라우저 재생 준비를 뜻하지 않습니다.</p><div className="codebox">{`POST /sessions\n{ "providerId": "tavus", "avatarId": "tavus-stock-lucy",\n  "mode": "live", "costConfirmed": true }`}</div></>}
    </div><aside className="surface setup-aside"><div className="eyebrow">가이드 목차</div><ul className="checklist"><li><ShieldCheck size={14} />프로젝트 격리와 scope</li><li><Code2 size={14} />백엔드 adapter</li><li><MessageSquareText size={14} />RoleplayX 사용자 context</li><li><CircleHelp size={14} />오류 코드와 cleanup</li></ul><p className="note">코드 예시는 기존 API 통합 가이드의 요청 형태를 따릅니다. 이 페이지는 요청을 실행하지 않습니다.</p></aside></div>
  </div>;
}

function Keys({ openModal }: { openModal: () => void }) {
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Developer console / project credentials</div><h1>API 키</h1><p className="lede">프로젝트마다 키와 권한을 분리하세요. 실제 키 관리는 인증된 Studio에서만 가능합니다.</p></div><button className="btn primary" onClick={openModal}><KeyRound size={14} />새 키 미리보기</button></div>
    <div className="surface list-panel"><div className="list-row"><div><h3>RoleplayX · 예시 프로젝트</h3><div className="avatar-sub mono">ar_sk_•••••••••••• · 실제 키 아님</div></div><span className="badge">샘플 행</span></div><div className="list-row"><div><span className="avatar-sub">이 프로젝트의 secret은 생성되거나 저장되지 않았습니다. 표시된 마스킹 문자열은 예시입니다.</span></div><button className="btn" onClick={openModal}>키 생성 흐름 보기</button></div></div>
    <div className="callout section-block">키 생성은 한 번만 표시되는 secret을 만듭니다. 이 모형은 지속 저장, 회전, 폐기를 수행하지 않으며 API key 값을 발급하지 않습니다.</div>
  </div>;
}

function Usage() {
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Developer console / usage</div><h1>사용량</h1><p className="lede">프로젝트와 provider 사용량은 연결된 실제 데이터를 불러와야 확인할 수 있습니다.</p></div></div>
    <div className="empty-state"><div className="empty-icon"><Wallet size={18} /></div><h3>표시할 실제 사용량이 없습니다</h3><p style={{ maxWidth: 430, margin: '8px auto', fontSize: 12 }}>현재 화면은 미리보기 데이터만 사용합니다. 요청량, 세션 시간, 비용을 추정하거나 성공 지표로 표시하지 않습니다.</p><span className="badge">요금 미확인</span></div>
    <div className="split section-block"><div className="info-tile"><h3>Provider 요금</h3><p>제공자 요금 확인이 필요합니다. 이 미리보기는 단가를 가정하지 않습니다.</p></div><div className="info-tile"><h3>세션과 비용</h3><p>라이브 세션에는 provider 비용이 발생할 수 있으며 사전 확인이 필요합니다.</p></div></div>
  </div>;
}

function Sessions() {
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Developer console / sessions</div><h1>세션</h1><p className="lede">세션 목록은 실제 프로젝트 연결 전까지 비어 있습니다. 샘플 상태는 실제 provider 상태를 나타내지 않습니다.</p></div></div>
    <CleanupBanner />
    <div className="surface list-panel section-block"><div className="list-row"><div><h3>정리 확인 필요 · 예시</h3><div className="avatar-sub">과거 불확실한 샘플 상태 · 미리보기 전용</div></div><span className="badge waiting">운영자 확인 필요</span></div><div className="list-row"><span className="avatar-sub">세션 종료 여부는 terminal 상태와 cleanupPending=false를 확인해야 합니다.</span><span className="mono avatar-sub">id 미제공</span></div></div>
    <p className="note">이 화면에는 운영자 조정 도구가 없습니다. 자동 정리 및 자동 재시도도 수행하지 않습니다.</p>
  </div>;
}

function Assets() {
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Developer console / my assets</div><h1>내 에셋</h1><p className="lede">개인 에셋은 계정 공간에 보관됩니다. RoleplayX 프로젝트 에셋과는 별도이며 자동 공유되지 않습니다.</p></div></div>
    <div className="empty-state"><div className="empty-icon"><Image size={18} /></div><h3>아직 등록된 에셋이 없습니다</h3><p style={{ fontSize: 12, maxWidth: 410, margin: '8px auto 15px' }}>에셋 업로드·프로비저닝은 실제 계정과 권한이 필요한 작업입니다. 미리보기에서는 이미지 선택이나 업로드를 실행할 수 없습니다.</p><button className="btn disabled" disabled><Image size={14} />업로드는 미리보기에서 사용할 수 없음</button></div>
    <div className="callout section-block">Tavus는 이미지 기반 커스텀 아바타 프로비저닝을 지원합니다. Anam은 이미지 프로비저닝을 지원하지 않습니다. 브라우저 재생은 별도 검증 대상입니다.</div>
  </div>;
}

function Pricing() {
  return <div className="page"><div className="page-head"><div><div className="eyebrow">Pricing / provider rates</div><h1>요금은 제공자에게 확인하세요</h1><p className="lede">현재 확인되지 않은 provider 요금을 임의로 계산하거나 세션 가격으로 표시하지 않습니다.</p></div></div>
    <div className="surface list-panel"><div className="list-row"><div><h3>Tavus</h3><div className="avatar-sub">라이브 아바타 · 커스텀 이미지 프로비저닝</div></div><span className="badge">제공자 요금 확인</span></div><div className="list-row"><div><h3>Anam</h3><div className="avatar-sub">stock 항목은 예시 · 이미지 프로비저닝 미지원</div></div><span className="badge">요금 미확인</span></div><div className="list-row"><div><h3>AvatarRouter</h3><div className="avatar-sub">provider credits / 달러 비용은 이 미리보기에서 확인하지 않음</div></div><span className="badge">정보 없음</span></div></div>
    <div className="callout section-block">라이브 생성·오디오 요청은 비용이 발생할 수 있습니다. 사전 명시 동의와 실제 환경의 provider 요금 확인이 필요합니다.</div>
  </div>;
}

function KeyModal({ close }: { close: () => void }) {
  return <div className="modal-scrim" role="presentation" onClick={close}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}>
    <div className="modal-head"><h2 id="modal-title">키 생성 미리보기</h2><button className="modal-close" onClick={close} aria-label="닫기"><X size={17} /></button></div>
    <p>이 프로토타입에서는 키를 생성하거나 저장하지 않습니다. 실제 키는 인증된 Studio에서 생성하고 한 번만 표시됩니다.</p>
    <div style={{ background: '#f6f4f8', border: '1px solid var(--line)', borderRadius: 7, padding: 13, marginTop: 13 }}><div className="eyebrow">형식 예시 · 실제 secret 아님</div><div className="mono" style={{ marginTop: 8, fontSize: 12, color: '#716881' }}>ar_sk_&lt;미리보기용_예시_키&gt;</div></div>
    <ul className="checklist"><li><LockKeyhole size={14} />RoleplayX server secret에만 저장</li><li><Check size={14} />필요한 scope만 선택</li><li><AlertTriangle size={14} />브라우저, URL, 로그에 노출 금지</li></ul>
    <div className="modal-actions"><button className="btn" onClick={close}>닫기</button><button className="btn primary" onClick={close}>확인</button></div>
  </section></div>;
}

export function RouterExperience() {
  const [page, setPage] = useState<Page>('catalog');
  const [selected, setSelected] = useState<Avatar>(avatars[0]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const navigate = (next: Page) => { setPage(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openDetail = (item: Avatar) => { setSelected(item); navigate('detail'); };
  return <div className="arx">
    <Header page={page} go={navigate} search={search} setSearch={setSearch} />
    {page === 'catalog' && <Catalog search={search} onSelect={openDetail} />}
    {page === 'detail' && <Detail item={selected} back={() => navigate('catalog')} goPlay={() => navigate('playground')} />}
    {page === 'playground' && <Playground initialAvatar={selected} />}
    {page === 'keys' && <Setup openModal={() => setModal(true)} goDocs={() => navigate('docs')} />}
    {page === 'docs' && <Docs />}
    {page === 'usage' && <Usage />}
    {page === 'sessions' && <Sessions />}
    {page === 'assets' && <Assets />}
    {page === 'pricing' && <Pricing />}
    {modal && <KeyModal close={() => setModal(false)} />}
  </div>;
}
