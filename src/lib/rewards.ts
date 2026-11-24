export const DAILY_REWARDS = [10, 20, 30, 40, 100] as const;
export const AD_REWARD = 15;
export const AD_LIMIT = 5;

export const DAY_MS = 24 * 60 * 60 * 1000;

export function nextDailyDay(streak: number, lastClaimAt: number, now = Date.now()): number {
  if (!lastClaimAt || now - lastClaimAt >= 2 * DAY_MS) return 1;
  return (Math.max(0, streak) % DAILY_REWARDS.length) + 1;
}

export function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}
