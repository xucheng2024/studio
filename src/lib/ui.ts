/** Shared Tailwind class strings — calm wellness palette (teal + stone). */

export const ui = {
  /** Default content width for marketing / booking */
  page: "mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 lg:px-8",
  pageNarrow: "mx-auto w-full max-w-md px-4 pb-20 pt-10 sm:px-6",
  pageWide: "mx-auto w-full max-w-6xl px-4 pb-20 pt-6 sm:px-6 lg:px-8",

  h1: "text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50 sm:text-4xl",
  h2: "text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50",
  lead: "text-[15px] leading-relaxed text-stone-600 dark:text-stone-300",

  card: "rounded-3xl border border-stone-200/90 bg-white/95 p-5 shadow-[0_14px_30px_-22px_rgba(28,25,23,0.55)] backdrop-blur-sm dark:border-stone-800/90 dark:bg-stone-900/70",
  cardInteractive:
    "rounded-3xl border border-stone-200/90 bg-white/95 p-5 shadow-[0_14px_30px_-22px_rgba(28,25,23,0.55)] backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-20px_rgba(20,184,166,0.35)] dark:border-stone-800/90 dark:bg-stone-900/70",

  input:
    "w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 shadow-inner shadow-stone-900/[0.03] placeholder:text-stone-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-500",
  select:
    "w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100",
  label: "text-sm font-medium text-stone-700 dark:text-stone-300",

  btnPrimary:
    "inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-[0_10px_22px_-14px_rgba(8,145,178,0.8)] transition hover:from-teal-500 hover:to-cyan-500 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:pointer-events-none disabled:opacity-50 dark:from-teal-500 dark:to-cyan-500",
  btnPrimarySm:
    "inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 px-3 py-1.5 text-sm font-medium text-white shadow-[0_10px_22px_-14px_rgba(8,145,178,0.8)] transition hover:from-teal-500 hover:to-cyan-500 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 disabled:pointer-events-none disabled:opacity-50 dark:from-teal-500 dark:to-cyan-500",
  btnSecondary:
    "inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm transition-colors hover:bg-stone-50 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 disabled:pointer-events-none disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800",
  btnSecondarySm:
    "inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 shadow-sm transition-colors hover:bg-stone-50 active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 disabled:pointer-events-none disabled:opacity-50 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800",
  btnGhost:
    "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 active:scale-[0.98] active:opacity-90 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",

  link: "font-medium text-teal-700 underline-offset-4 transition-colors hover:text-teal-800 hover:underline dark:text-teal-400 dark:hover:text-teal-300",
  linkMuted: "text-sm text-stone-500 underline-offset-4 transition-colors hover:text-stone-800 hover:underline dark:text-stone-400 dark:hover:text-stone-200",

  badge:
    "inline-flex items-center rounded-full border border-teal-200/70 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900 dark:border-teal-800/60 dark:bg-teal-950/60 dark:text-teal-100",
  code: "rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200",

  headerBar:
    "sticky top-0 z-40 border-b border-stone-200/80 bg-white/90 backdrop-blur-xl dark:border-stone-800 dark:bg-stone-950/90",
  muted: "text-sm text-stone-500 dark:text-stone-400",
  error: "text-sm text-red-600 dark:text-red-400",
  success: "text-sm text-teal-700 dark:text-teal-300",

  statCard:
    "rounded-2xl border border-stone-200/90 bg-white/90 p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900/60",
  sidebar:
    "rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4 dark:border-stone-800 dark:bg-stone-900/40",
} as const;
