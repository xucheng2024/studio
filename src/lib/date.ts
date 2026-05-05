export function localISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayRangeStartIso(dateText?: string | null) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function dayRangeEndExclusiveIso(dateText?: string | null) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function dayRangeEndInclusiveIso(dateText?: string | null) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T23:59:59`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
