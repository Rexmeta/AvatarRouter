import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'ko';

const dict = {
  'nav.explore': ['Explore', '탐색'],
  'nav.playground': ['Playground', '플레이그라운드'],
  'nav.providers': ['Providers', '프로바이더'],
  'nav.sessions': ['Sessions', '세션'],
  'nav.usage': ['Usage', '사용량'],
  'nav.assets': ['Avatar assets', '아바타 에셋'],
  'nav.docs': ['Docs', '문서'],
  'nav.apiKeys': ['API keys', 'API 키'],
  'keys.title': ['API keys', 'API 키'],
  'brand.tag': ['Integration workbench', '통합 워크벤치'],
  'phase': ['Phase 1 foundation', '1단계 기반'],
  'footer.api': ['API', 'API'],
  'footer.db': ['Database', '데이터베이스'],
  'footer.live': ['Live mode', '라이브 모드'],
  'enabled': ['enabled', '활성'],
  'disabled': ['disabled', '비활성'],
  'home.title1': ['Route real-time avatars', '실시간 아바타를'],
  'home.title2': ['into the dialogue you already run.', '기존 AI 대화에 연결하세요.'],
  'home.lede': [
    'AvatarRouter Studio is a workbench for wiring official avatar providers to an existing AI conversation. It reports what is actually configured and verified — nothing is staged.',
    'AvatarRouter Studio는 공식 아바타 프로바이더를 기존 AI 대화에 연결하기 위한 워크벤치입니다. 실제로 설정되고 검증된 것만 보고합니다.',
  ],
  'home.openPlayground': ['Open playground', '플레이그라운드 열기'],
  'home.readFindings': ['Read findings', '분석 결과 보기'],
  'home.integration': ['Integration status', '통합 상태'],
  'home.providers': ['Official providers', '공식 프로바이더'],
  'home.avatars': ['Avatar catalog', '아바타 카탈로그'],
  'home.mockNote': ['Local synthetic lifecycle test. No provider video, AI or speech.', '로컬 합성 라이프사이클 테스트입니다. 프로바이더 영상, AI, 음성 없음.'],
  'stage': ['Stage', '단계'],
  'roleplayx': ['RoleplayX', 'RoleplayX'],
  'bridge': ['Audio bridge', '오디오 브리지'],
  'secrets': ['Secret presence', '시크릿 존재 여부'],
  'secrets.note': ['Configured via Replit Secrets. Values are never shown or accepted here.', 'Replit Secrets로 설정됩니다. 값은 표시되거나 입력받지 않습니다.'],
  'present': ['present', '있음'],
  'absent': ['absent', '없음'],
  'pg.title': ['Playground', '플레이그라운드'],
  'pg.lede': ['Choose a target. Real providers return configuration diagnostics; the mock runs an explicit synthetic lifecycle.', '대상을 선택하세요. 실제 프로바이더는 설정 진단을, 목은 명시적 합성 라이프사이클을 실행합니다.'],
  'pg.target': ['Target', '대상'],
  'pg.start': ['Start mock session', '목 세션 시작'],
  'pg.tryLive': ['Request live session', '라이브 세션 요청'],
  'pg.interrupt': ['Interrupt', '중단 신호'],
  'pg.end': ['End session', '세션 종료'],
  'pg.diag': ['Configuration diagnostics', '설정 진단'],
  'pg.missing': ['Missing', '누락'],
  'pg.nothingMissing': ['No missing items reported.', '누락 항목 없음.'],
  'pg.timeline': ['Session timeline', '세션 타임라인'],
  'pg.noSession': ['No session running. Start one to see persisted events.', '실행 중인 세션이 없습니다. 시작하면 저장된 이벤트가 표시됩니다.'],
  'pg.synthetic': ['SYNTHETIC — not a provider stream', '합성 — 프로바이더 스트림 아님'],
  'pg.idle': ['Idle', '대기'],
  'mic.title': ['Microphone check', '마이크 점검'],
  'mic.note': ['Local check only. Audio is not recorded or transmitted.', '로컬 점검 전용. 오디오는 녹음되거나 전송되지 않습니다.'],
  'mic.start': ['Test microphone', '마이크 테스트'],
  'mic.stop': ['Release microphone', '마이크 해제'],
  'mic.denied': ['Permission denied or unavailable.', '권한 거부 또는 사용 불가.'],
  'prov.title': ['Providers', '프로바이더'],
  'prov.lede': ['Official LiveKit avatar plugins and their verified state in this deployment.', '공식 LiveKit 아바타 플러그인과 이 배포에서의 검증 상태.'],
  'prov.runtime': ['Runtime', '런타임'],
  'prov.modes': ['Modes', '모드'],
  'prov.extAudio': ['External audio', '외부 오디오'],
  'prov.impl': ['Adapter', '어댑터'],
  'prov.implemented': ['implemented', '구현됨'],
  'prov.pending': ['pending', '대기'],
  'prov.validation': ['Validation', '검증'],
  'prov.source': ['Official source', '공식 출처'],
  'yes': ['yes', '예'],
  'no': ['no', '아니오'],
  'sess.title': ['Sessions', '세션'],
  'sess.lede': ['Sessions owned by this browser, persisted server-side with their event log.', '이 브라우저가 소유한 세션과 이벤트 로그.'],
  'sess.empty': ['No sessions yet. The playground mock is the quickest way to create one.', '아직 세션이 없습니다. 플레이그라운드 목으로 생성해 보세요.'],
  'sess.select': ['Select a session to inspect its events.', '이벤트를 보려면 세션을 선택하세요.'],
  'sess.events': ['Events', '이벤트'],
  'sess.noEvents': ['No events recorded.', '기록된 이벤트 없음.'],
  'started': ['Started', '시작'],
  'ended': ['Ended', '종료'],
  'expires': ['Expires', '만료'],
  'duration': ['Duration', '지속 시간'],
  'interruptions': ['Interruptions', '중단 횟수'],
  'error': ['Error', '오류'],
  'use.title': ['Usage', '사용량'],
  'use.lede': ['Local observations from persisted sessions. Billing figures stay empty until a provider source confirms them.', '저장된 세션의 로컬 관측값. 청구 수치는 프로바이더가 확인할 때까지 비어 있습니다.'],
  'use.total': ['Total sessions', '전체 세션'],
  'use.active': ['Active now', '현재 활성'],
  'use.connected': ['Connected time', '연결 시간'],
  'use.errors': ['Errors', '오류'],
  'use.mock': ['Mock sessions', '목 세션'],
  'use.billing': ['Billing', '청구'],
  'use.est': ['Estimated cost', '예상 비용'],
  'use.conf': ['Confirmed cost', '확정 비용'],
  'use.billable': ['Billable seconds', '청구 초'],
  'use.unsourced': ['not sourced', '출처 없음'],
  'use.why': ['Connected duration is not assumed to equal billable duration. No provider billing source is connected.', '연결 시간을 청구 시간으로 가정하지 않습니다. 프로바이더 청구 소스가 연결되어 있지 않습니다.'],
  'docs.title': ['Architecture findings', '아키텍처 분석'],
  'retry': ['Retry', '재시도'],
  'loadFail': ['Could not load data.', '데이터를 불러올 수 없습니다.'],
  'copy': ['Copy', '복사'],
  'copied': ['Copied', '복사됨'],
} as const;

export type TKey = keyof typeof dict;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string }>({
  lang: 'en',
  setLang: () => {},
  t: (k) => dict[k][0],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('ar-lang') === 'ko' ? 'ko' : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    try { localStorage.setItem('ar-lang', lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);
  const t = (k: TKey) => dict[k][lang === 'en' ? 0 : 1];
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
