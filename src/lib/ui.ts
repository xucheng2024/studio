/** Shared Tailwind class strings — calm wellness palette (teal + stone). */

export const ui = {
  /* ── Layout ─────────────────────────────────────────────────────── */
  page: "mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:px-8",
  pageNarrow: "mx-auto w-full max-w-md px-4 pb-20 pt-10 sm:px-6",
  pageWide: "mx-auto w-full max-w-6xl px-4 pb-6 pt-6 sm:px-6 lg:px-8",
  /** Inner dashboard content — extra bottom padding avoids mobile nav overlap */
  pageDash: "min-w-0 flex-1 pb-24 md:pb-10",

  /* ── Typography ─────────────────────────────────────────────────── */
  h1: "text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50 sm:text-3xl",
  h2: "text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-50",
  h3: "text-base font-semibold text-stone-800 dark:text-stone-100",
  lead: "text-[15px] leading-relaxed text-stone-600 dark:text-stone-300",
  muted: "text-sm text-stone-500 dark:text-stone-400",
  error: "text-sm text-red-600 dark:text-red-400",
  success: "text-sm text-teal-700 dark:text-teal-300",

  /* ── Cards ──────────────────────────────────────────────────────── */
  card: "rounded-2xl border border-stone-200/90 bg-white/95 p-4 shadow-sm dark:border-stone-800/90 dark:bg-stone-900/70 sm:p-5",
  cardInteractive:
    "cursor-pointer rounded-2xl border border-stone-200/90 bg-white/95 p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-teal-500/10 active:translate-y-0 active:scale-[0.99] active:opacity-95 dark:border-stone-800/90 dark:bg-stone-900/70 dark:hover:shadow-teal-400/10 sm:p-5",
  statCard:
    "rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900/60",
  sidebar:
    "rounded-2xl border border-stone-200/70 bg-stone-50/90 p-4 dark:border-stone-800 dark:bg-stone-900/40",

  /* ── Section dividers inside cards ──────────────────────────────── */
  sectionHeader:
    "border-b border-stone-100 pb-3 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:border-stone-800 dark:text-stone-500",
  divider: "border-t border-stone-100 dark:border-stone-800",

  /* ── Empty state ─────────────────────────────────────────────────── */
  emptyState:
    "flex flex-col items-center gap-2 rounded-2xl border border-dashed border-stone-200 py-10 text-center dark:border-stone-700",
  emptyStateIcon:
    "flex size-10 items-center justify-center rounded-full bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500",

  /* ── Inline feedback messages ────────────────────────────────────── */
  feedbackSuccess:
    "flex items-center gap-1.5 text-xs text-teal-700 dark:text-teal-400",
  feedbackError:
    "flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400",
  feedbackInfo:
    "flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400",

  /* ── Forms ──────────────────────────────────────────────────────── */
  input:
    "w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500",
  select:
    "min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm leading-normal text-stone-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100",
  label: "text-sm font-medium text-stone-700 dark:text-stone-300",

  /* ── Buttons ─────────────────────────────────────────────────────── */
  btnPrimary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-600/20 transition hover:from-teal-500 hover:to-cyan-500 hover:shadow-lg hover:shadow-teal-500/25 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:pointer-events-none disabled:opacity-50",
  btnPrimarySm:
    "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-cyan-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-teal-600/20 transition hover:from-teal-500 hover:to-cyan-500 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:pointer-events-none disabled:opacity-50",
  btnSecondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 hover:border-stone-300 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 disabled:pointer-events-none disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800",
  btnSecondarySm:
    "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 hover:border-stone-300 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 disabled:pointer-events-none disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800",
  btnGhost:
    "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.98] active:opacity-90 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
  btnDanger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:border-red-900/50 dark:bg-stone-900 dark:text-red-400 dark:hover:bg-red-950/30",
  btnDangerSm:
    "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:border-red-900/50 dark:bg-stone-900 dark:text-red-400 dark:hover:bg-red-950/30",
  mobileActionBar:
    "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-10 -mx-1 rounded-xl border border-stone-200/80 bg-white/95 p-2 shadow-lg shadow-stone-900/10 backdrop-blur md:static md:mx-0 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none dark:border-stone-700/80 dark:bg-stone-950/95 md:dark:bg-transparent",

  /* ── Links ──────────────────────────────────────────────────────── */
  link: "inline-flex items-center gap-1 font-medium text-teal-700 underline-offset-4 transition hover:text-teal-800 hover:underline active:opacity-80 dark:text-teal-400 dark:hover:text-teal-300",
  linkMuted:
    "inline-flex items-center gap-1 text-sm text-stone-500 underline-offset-4 transition hover:text-stone-800 hover:underline active:opacity-80 dark:text-stone-400 dark:hover:text-stone-200",

  /* ── Badges / pills ─────────────────────────────────────────────── */
  badge:
    "inline-flex items-center rounded-full border border-teal-200/70 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-900 dark:border-teal-800/60 dark:bg-teal-950/60 dark:text-teal-100",
  badgeNeutral:
    "inline-flex items-center rounded-full border border-stone-200 bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300",
  badgeAmber:
    "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-300",
  badgeRed:
    "inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-300",
  code: "rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200",

  /* ── Header ─────────────────────────────────────────────────────── */
  headerBar:
    "sticky top-0 z-40 border-b border-stone-200/70 bg-white/85 backdrop-blur-xl dark:border-stone-800/70 dark:bg-stone-950/85",
  linkHeaderNav:
    "rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 active:scale-[0.98] sm:text-sm dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
  linkHeaderMenu:
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100 hover:text-stone-900 active:opacity-80 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
  linkHeaderBrand:
    "text-sm font-bold tracking-tight text-stone-900 transition active:opacity-80 dark:text-stone-100",
} as const;
