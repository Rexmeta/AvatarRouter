import { useEffect, useState } from 'react';

export type SelectedAsset = { id: string; name: string; providerId: string; providerAvatarId: string | null; imageAssetId: string };
const KEY = 'ar-selected-avatar-asset';
const EVT = 'ar-selected-asset-change';

export function setSelectedAsset(a: SelectedAsset | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVT));
}

function read(): SelectedAsset | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as SelectedAsset) : null;
  } catch {
    return null;
  }
}

export function useSelectedAsset() {
  const [a, setA] = useState<SelectedAsset | null>(read);
  useEffect(() => {
    const h = () => setA(read());
    window.addEventListener(EVT, h);
    window.addEventListener('storage', h);
    return () => { window.removeEventListener(EVT, h); window.removeEventListener('storage', h); };
  }, []);
  return a;
}
