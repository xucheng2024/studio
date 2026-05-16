const BUSINESS_TIME_ZONE = "Asia/Singapore";
export const BUSINESS_UTC_OFFSET = "+08:00";
const DEFAULT_LOCALE = "en-SG";

/**
 * Parse a "YYYY-MM-DDTHH:MM" string (from a datetime-local input) as SGT.
 * Returns null if the string is empty or invalid.
 */
export function parseDatetimeLocalAsSgt(raw: string): Date | null {
  if (!raw) return null;
  // Append seconds + SGT offset so the Date constructor treats it as SGT wall time
  const d = new Date(`${raw}:00${BUSINESS_UTC_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function localISODate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((part) => part.type === "year")?.value ?? "";
  const m = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${y}-${m}-${day}`;
}

export function dayRangeStartIso(dateText?: string | null) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00${BUSINESS_UTC_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function dayRangeEndExclusiveIso(dateText?: string | null) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00${BUSINESS_UTC_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

export function dayRangeEndInclusiveIso(dateText?: string | null) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T23:59:59${BUSINESS_UTC_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function formatLocalDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
  locale = DEFAULT_LOCALE,
) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { timeZone: BUSINESS_TIME_ZONE, ...options });
}

export function formatLocalDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  locale = DEFAULT_LOCALE,
) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { timeZone: BUSINESS_TIME_ZONE, ...options });
}

export function formatLocalTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
  locale = DEFAULT_LOCALE,
) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { timeZone: BUSINESS_TIME_ZONE, ...options });
}

/**
 * Returns "YYYY-MM-DDTHH:MM" in SGT for populating a datetime-local input.
 * Uses Intl so the result is correct regardless of the server's process timezone.
 */
export function toLocalDateTimeInputValue(value: string | number | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hh}:${get("minute")}`;
}

/**
 * Returns "YYYY-MM-DD" bucketed in SGT (for grouping by local calendar day).
 * Uses Intl so the result is correct regardless of the server's process timezone.
 */
export function localDateKey(value: string | number | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
