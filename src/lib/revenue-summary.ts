import { localDateKey } from "@/lib/date";

/** Rows used for Gross / Refunds / Net (bucketed by finance-effective timestamp). */
export type RevenuePaymentRow = {
  status: string;
  amount: unknown;
  created_at?: string | null;
  verified_at?: string | null;
  refunded_at?: string | null;
  location_id?: string | null;
  source?: string | null;
};

export type RevenueOrderType = "session" | "event" | "package" | "membership" | "member_zone" | "shop";

export function revenueOrderTypeFromSource(source: string | null | undefined): RevenueOrderType {
  switch (source) {
    case "event_booking":
      return "event";
    case "package_buy":
      return "package";
    case "membership_subscription":
      return "membership";
    case "member_zone_purchase":
      return "member_zone";
    case "shop_purchase":
      return "shop";
    default:
      return "session";
  }
}

export function revenueEffectiveTimestamp(row: RevenuePaymentRow) {
  if (row.status === "refunded") {
    return row.refunded_at ?? row.verified_at ?? row.created_at ?? null;
  }
  if (row.status === "paid") {
    return row.verified_at ?? row.created_at ?? null;
  }
  return row.created_at ?? null;
}

export function computeRevenueSummary(rows: RevenuePaymentRow[]) {
  let gross = 0;
  let refunds = 0;
  for (const p of rows) {
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") gross += amt;
    else if (p.status === "refunded") {
      gross += amt;
      refunds += amt;
    }
  }
  return { gross, refunds, net: gross - refunds };
}

export function revenueByDay(rows: RevenuePaymentRow[]) {
  const map = new Map<string, { gross: number; refunds: number }>();
  for (const p of rows) {
    const day = localDateKey(revenueEffectiveTimestamp(p));
    if (!day) continue;
    if (!map.has(day)) map.set(day, { gross: 0, refunds: 0 });
    const m = map.get(day)!;
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") m.gross += amt;
    else if (p.status === "refunded") {
      m.gross += amt;
      m.refunds += amt;
    }
  }
  return [...map.entries()]
    .map(([day, v]) => ({ day, gross: v.gross, refunds: v.refunds, net: v.gross - v.refunds }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function revenueByOrderType(rows: RevenuePaymentRow[]) {
  const map = new Map<RevenueOrderType, { gross: number; refunds: number }>([
    ["session", { gross: 0, refunds: 0 }],
    ["event", { gross: 0, refunds: 0 }],
    ["package", { gross: 0, refunds: 0 }],
    ["membership", { gross: 0, refunds: 0 }],
    ["member_zone", { gross: 0, refunds: 0 }],
    ["shop", { gross: 0, refunds: 0 }],
  ]);

  for (const p of rows) {
    const key = revenueOrderTypeFromSource(p.source);
    const entry = map.get(key)!;
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") entry.gross += amt;
    else if (p.status === "refunded") {
      entry.gross += amt;
      entry.refunds += amt;
    }
  }

  return {
    session: { ...map.get("session")!, net: map.get("session")!.gross - map.get("session")!.refunds },
    event: { ...map.get("event")!, net: map.get("event")!.gross - map.get("event")!.refunds },
    package: { ...map.get("package")!, net: map.get("package")!.gross - map.get("package")!.refunds },
    membership: { ...map.get("membership")!, net: map.get("membership")!.gross - map.get("membership")!.refunds },
    memberZone: { ...map.get("member_zone")!, net: map.get("member_zone")!.gross - map.get("member_zone")!.refunds },
    shop: { ...map.get("shop")!, net: map.get("shop")!.gross - map.get("shop")!.refunds },
  };
}

export function revenueByDayAndOrderType(rows: RevenuePaymentRow[]) {
  const map = new Map<
    string,
    {
      session: { gross: number; refunds: number };
      event: { gross: number; refunds: number };
      package: { gross: number; refunds: number };
      membership: { gross: number; refunds: number };
      member_zone: { gross: number; refunds: number };
      shop: { gross: number; refunds: number };
      gross: number;
      refunds: number;
    }
  >();

  for (const p of rows) {
    const day = localDateKey(revenueEffectiveTimestamp(p));
    if (!day) continue;
    if (!map.has(day)) {
      map.set(day, {
        session: { gross: 0, refunds: 0 },
        event: { gross: 0, refunds: 0 },
        package: { gross: 0, refunds: 0 },
        membership: { gross: 0, refunds: 0 },
        member_zone: { gross: 0, refunds: 0 },
        shop: { gross: 0, refunds: 0 },
        gross: 0,
        refunds: 0,
      });
    }
    const row = map.get(day)!;
    const key = revenueOrderTypeFromSource(p.source);
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") {
      row[key].gross += amt;
      row.gross += amt;
    } else if (p.status === "refunded") {
      row[key].gross += amt;
      row[key].refunds += amt;
      row.gross += amt;
      row.refunds += amt;
    }
  }

  return [...map.entries()]
    .map(([day, v]) => ({
      day,
      gross: v.gross,
      refunds: v.refunds,
      net: v.gross - v.refunds,
      sessionNet: v.session.gross - v.session.refunds,
      eventNet: v.event.gross - v.event.refunds,
      packageNet: v.package.gross - v.package.refunds,
      membershipNet: v.membership.gross - v.membership.refunds,
      memberZoneNet: v.member_zone.gross - v.member_zone.refunds,
      shopNet: v.shop.gross - v.shop.refunds,
    }))
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
    else if (p.status === "refunded") {
      m.gross += amt;
      m.refunds += amt;
    }
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
    else if (p.status === "refunded") {
      m.gross += amt;
      m.refunds += amt;
    }
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, gross: v.gross, refunds: v.refunds, net: v.gross - v.refunds }))
    .sort((a, b) => b.net - a.net);
}
