const sections = [
  { id: 'images', workspacePath: 'asset-images', personalPath: '/avatar-assets/images', en: 'Source images', ko: '원본 이미지' },
  { id: 'avatars', workspacePath: 'assets', personalPath: '/avatar-assets', en: 'Custom avatars', ko: '커스텀 아바타' },
  { id: 'faces', workspacePath: 'stock-faces', personalPath: null, en: 'Stock faces', ko: '스톡 얼굴' },
  { id: 'voices', workspacePath: 'stock-voices', personalPath: null, en: 'Stock voices', ko: '스톡 음성' },
  { id: 'guide', workspacePath: 'asset-guide', personalPath: '/avatar-assets/guide', en: 'Creation guide', ko: '생성 가이드' },
] as const;

export type AvatarAssetSection = (typeof sections)[number]['id'];

export function workspaceAvatarAssetSection(path: string, id?: string) {
  const section = sections.find(item => item.workspacePath === path);
  return !id || section?.id === 'avatars' ? section?.id : undefined;
}

export function avatarAssetNavigation(projectId?: string) {
  return sections.flatMap(item => {
    const href = projectId ? `/workspaces/${projectId}/${item.workspacePath}` : item.personalPath;
    return href ? [{ ...item, href }] : [];
  });
}

export function activeAvatarAssetSection(path: string, projectId?: string): AvatarAssetSection | undefined {
  const current = path.split(/[?#]/, 1)[0]!.replace(/\/$/, '');
  const nav = avatarAssetNavigation(projectId);
  const exact = nav.find(item => item.href === current);
  if (exact) return exact.id;
  const avatars = nav.find(item => item.id === 'avatars');
  if (avatars && current.startsWith(`${avatars.href}/`) && !current.slice(avatars.href.length + 1).includes('/')) return 'avatars';
  return undefined;
}
