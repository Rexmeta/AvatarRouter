export function minutesToSeconds(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const m = Number(raw.trim());
  return Number.isSafeInteger(m) && m >= 0 && m <= 1440 ? m * 60 : null;
}
export function validateBudget(scope: 'project' | 'service', seconds: number | null, b: { service: { dailySeconds: number } }): 'invalid' | 'exceeds_service' | null {
  if (seconds === null || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86400) return 'invalid';
  return scope === 'project' && seconds > b.service.dailySeconds ? 'exceeds_service' : null;
}
