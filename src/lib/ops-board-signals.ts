export type OpsCapacitySignal = "full" | "almost_full" | null;

export function opsCapacitySignal(capacity: number, spotsLeft: number): OpsCapacitySignal {
  if (capacity <= 0) return null;
  if (spotsLeft <= 0) return "full";
  const almostFullThreshold = Math.max(2, Math.ceil(capacity * 0.2));
  if (spotsLeft <= almostFullThreshold) return "almost_full";
  return null;
}

export function opsAttendeeSortRank(status: string): number {
  if (status === "pending") return 0;
  if (status === "booked") return 1;
  if (status === "attended") return 2;
  return 3;
}

export const opsAttendeeRowClass =
  "rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40";
export const opsUnpaidAttendeeRowClass =
  "rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30";
