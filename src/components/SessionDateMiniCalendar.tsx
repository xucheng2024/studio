/** Resolve `locations ( name )` from a Supabase session row (object or array). */
export function sessionLocationLabel(session: {
  locations?: { name?: string | null } | { name?: string | null }[] | null;
}): string | null {
  const loc = session.locations;
  const row = Array.isArray(loc) ? loc[0] : loc;
  const t = String(row?.name ?? "").trim();
  return t || null;
}

/** Bottom-left pill on session/class cover (same family as spots/price badges). */
export function CoverLocationCornerBadge({ name }: { name: string | null | undefined }) {
  const n = String(name ?? "").trim();
  if (!n) return null;
  return (
    <span
      className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(18rem,calc(100%-1.5rem))] truncate rounded-full bg-black/70 px-2.5 py-1 text-left text-xs font-semibold text-white shadow-sm backdrop-blur-sm dark:bg-black/75"
      title={n}
    >
      {n}
    </span>
  );
}

type Variant = "compact" | "default" | "prominent";

const variantClass: Record<Variant, string> = {
  compact: "w-12 py-1",
  default: "w-14 py-1.5",
  prominent: "w-14 py-2",
};

const dayNumClass: Record<Variant, string> = {
  compact: "text-lg",
  default: "text-xl",
  prominent: "text-xl",
};

/** Small “calendar” block used on public class pages. */
export function SessionDateMiniCalendar({
  weekdayLabel,
  dayOfMonth,
  monthLabel,
  variant = "default",
}: {
  weekdayLabel: string;
  dayOfMonth: number;
  monthLabel: string;
  variant?: Variant;
}) {
  const box = variantClass[variant];
  const dayCls = dayNumClass[variant];

  return (
    <div className="shrink-0">
      <div
        className={`flex ${box} shrink-0 flex-col items-center rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800`}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          {weekdayLabel}
        </span>
        <span className={`${dayCls} font-bold leading-tight text-stone-900 dark:text-stone-50`}>{dayOfMonth}</span>
        <span className="text-[10px] text-stone-500 dark:text-stone-400">{monthLabel}</span>
      </div>
    </div>
  );
}
