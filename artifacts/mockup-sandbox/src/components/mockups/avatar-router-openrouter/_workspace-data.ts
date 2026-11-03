export type Workspace = {
  id: string;
  name: string;
  description: string;
  kind: 'development' | 'production' | 'local';
  sampleKey: boolean;
  sampleSession: boolean;
  assets: string[];
};

export type AccountPage =
  | 'workspaces' | 'profile' | 'account-activity' | 'account-logs' | 'credits'
  | 'account-guardrails' | 'management-keys' | 'notifications' | 'privacy'
  | 'security' | 'preferences';

export type WorkspacePage =
  | 'activity' | 'sessions' | 'api-keys' | 'usage' | 'assets'
  | 'limits' | 'settings';

export type PublicPage = 'avatars' | 'playground' | 'docs';

export const initialWorkspaces: Workspace[] = [
  {
    id: 'sample-development',
    name: 'RoleplayX · 개발',
    description: '개발 환경 · 연동 및 아바타 선택 테스트',
    kind: 'development',
    sampleKey: true,
    sampleSession: true,
    assets: [],
  },
  {
    id: 'sample-production',
    name: 'RoleplayX · 운영',
    description: '운영 환경 · 실제 사용 전 별도 확인 필요',
    kind: 'production',
    sampleKey: false,
    sampleSession: false,
    assets: ['기본 아바타 참조 · 샘플'],
  },
];

export const accountNavigation: { id: AccountPage; label: string; icon: string; proposal?: boolean }[] = [
  { id: 'workspaces', label: '워크스페이스', icon: 'grid' },
  { id: 'profile', label: '프로필', icon: 'user' },
  { id: 'account-activity', label: '활동', icon: 'activity' },
  { id: 'account-logs', label: '로그', icon: 'file' },
  { id: 'credits', label: '크레딧', icon: 'wallet', proposal: true },
  { id: 'account-guardrails', label: '사용 한도', icon: 'shield', proposal: true },
  { id: 'management-keys', label: '관리 키', icon: 'key', proposal: true },
  { id: 'notifications', label: '알림', icon: 'bell', proposal: true },
  { id: 'privacy', label: '개인정보', icon: 'lock', proposal: true },
  { id: 'security', label: '보안', icon: 'shield' },
  { id: 'preferences', label: '환경설정', icon: 'sliders' },
];

export const workspaceNavigation: { id: WorkspacePage; label: string; icon: string }[] = [
  { id: 'activity', label: '활동', icon: 'activity' },
  { id: 'sessions', label: '세션·로그', icon: 'file' },
  { id: 'api-keys', label: 'API 키', icon: 'key' },
  { id: 'usage', label: '사용량', icon: 'chart' },
  { id: 'assets', label: '아바타·에셋', icon: 'image' },
  { id: 'limits', label: '사용 한도', icon: 'shield' },
  { id: 'settings', label: '설정', icon: 'settings' },
];

export const proposedMappingNote =
  '워크스페이스는 계정 안에서 프로젝트 환경을 구분하기 위한 UX 제안입니다. Studio 개인 네임스페이스와 API 키가 속한 프로젝트 네임스페이스는 별개이며, 이 화면은 프로젝트 생성·이름 변경·이관을 실행하지 않습니다.';
