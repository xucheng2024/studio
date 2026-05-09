/**
 * Helpers for formatting dates in Singapore Time (Asia/Singapore, UTC+8).
 * Always pass timeZone explicitly so output is consistent on any server locale.
 */
const LOCALE = "en-SG";
const TZ = "Asia/Singapore";

function toDate(d: Date | string): Date {
  return typeof d === "string" ? new Date(d) : d;
}

export function fmtSGDate(d: Date | string, opts: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}): string {
  return toDate(d).toLocaleDateString(LOCALE, { ...opts, timeZone: TZ });
}

export function fmtSGTime(d: Date | string, opts: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}): string {
  return toDate(d).toLocaleTimeString(LOCALE, { ...opts, timeZone: TZ });
}

export function fmtSGDateTime(d: Date | string, opts: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}): string {
  return toDate(d).toLocaleString(LOCALE, { ...opts, timeZone: TZ });
}
