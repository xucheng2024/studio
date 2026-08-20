/** Late arrivals can still walk in this long after the listed start time. */
export const WALKIN_START_GRACE_MS = 15 * 60 * 1000;

export function walkinStartIsOpen(startTime: string | null | undefined, now = Date.now()) {
  if (!startTime) return false;
  const start = new Date(startTime).getTime();
  return Number.isFinite(start) && start + WALKIN_START_GRACE_MS >= now;
}
