const BUSINESS_TIME_ZONE = "Asia/Singapore";
const BUSINESS_UTC_OFFSET = "+08:00";

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
