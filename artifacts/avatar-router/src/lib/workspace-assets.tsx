import { createContext, useContext } from 'react';

export const WorkspaceAssetContext = createContext<string | null>(null);
export function useAssetWorkspace() {
  const projectId = useContext(WorkspaceAssetContext);
  const request = projectId ? { headers: { 'X-Avatar-Workspace-ID': projectId } } : undefined;
  const base = projectId ? `/workspaces/${projectId}/assets` : '/avatar-assets';
  const imageUrl = (id: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/v1/assets/images/${id}/content${projectId ? `?workspaceId=${encodeURIComponent(projectId)}` : ''}`;
  return { projectId, request, base, imageUrl };
}
