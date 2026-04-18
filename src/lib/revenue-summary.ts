/** Rows used for Gross / Refunds / Net (payment created_at within the report window). */
export type RevenuePaymentRow = {
  status: string;
  amount: unknown;
  created_at?: string | null;
  location_id?: string | null;
};

export function computeRevenueSummary(rows: RevenuePaymentRow[]) {
  let gross = 0;
  let refunds = 0;
  for (const p of rows) {
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") gross += amt;
    else if (p.status === "refunded") refunds += amt;
  }
  return { gross, refunds, net: gross - refunds };
}

export function revenueByDay(rows: RevenuePaymentRow[]) {
  const map = new Map<string, { gross: number; refunds: number }>();
  for (const p of rows) {
    const day = (p.created_at ?? "").slice(0, 10);
    if (!day) continue;
    if (!map.has(day)) map.set(day, { gross: 0, refunds: 0 });
    const m = map.get(day)!;
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") m.gross += amt;
    else if (p.status === "refunded") m.refunds += amt;
  }
  return [...map.entries()]
    .map(([day, v]) => ({ day, gross: v.gross, refunds: v.refunds, net: v.gross - v.refunds }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function revenueByLocationLabel(
  rows: RevenuePaymentRow[],
  locationNames: Map<string, string>,
) {
  const map = new Map<string, { gross: number; refunds: number }>();
  for (const p of rows) {
    const lid = p.location_id ?? "";
    const label =
      (lid && locationNames.get(lid)) || (lid ? `Location ${lid.slice(0, 8)}…` : "Unassigned location");
    if (!map.has(label)) map.set(label, { gross: 0, refunds: 0 });
    const m = map.get(label)!;
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") m.gross += amt;
    else if (p.status === "refunded") m.refunds += amt;
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, gross: v.gross, refunds: v.refunds, net: v.gross - v.refunds }))
    .sort((a, b) => b.net - a.net);
}

export function revenueByClassTitle(
  rows: Array<RevenuePaymentRow & { classTitle: string | null }>,
) {
  const map = new Map<string, { gross: number; refunds: number }>();
  for (const p of rows) {
    const title = (p.classTitle ?? "").trim() || "Other (no class link)";
    if (!map.has(title)) map.set(title, { gross: 0, refunds: 0 });
    const m = map.get(title)!;
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") m.gross += amt;
    else if (p.status === "refunded") m.refunds += amt;
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, gross: v.gross, refunds: v.refunds, net: v.gross - v.refunds }))
    .sort((a, b) => b.net - a.net);
}
