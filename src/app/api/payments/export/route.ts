import { NextResponse } from "next/server";
import { bestRole, buildAccessContext } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replaceAll("\"", "\"\"")}"`;
  }
  return s;
}

function dayRangeStart(d?: string | null) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function dayRangeEnd(d?: string | null) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const studioId = url.searchParams.get("studio_id");
  const locationId = url.searchParams.get("location_id");
  const status = url.searchParams.get("status");
  const reconStatus = url.searchParams.get("recon_status");
  const amountMin = url.searchParams.get("amount_min");
  const amountMax = url.searchParams.get("amount_max");
  const reference = url.searchParams.get("reference");
  const from = dayRangeStart(url.searchParams.get("date_from"));
  const to = dayRangeEnd(url.searchParams.get("date_to"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ctx = await buildAccessContext({ userId: user.id, email: user.email });
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  if (!studioIds.length) return NextResponse.json({ error: "no_studio" }, { status: 404 });
  if (studioId && !studioIds.includes(studioId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const exportStudioIds = studioId ? [studioId] : studioIds;
  const { data: contractRows } = await supabase
    .from("studios")
    .select("id, contract_status")
    .in("id", exportStudioIds);
  if ((contractRows ?? []).some((r) => r.contract_status === "suspended")) {
    return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
  }

  let q = supabase
    .from("payments")
    .select("id, booking_id, status, recon_status, amount, paid_amount, currency, reference_code, created_at, customer_confirmed_at, verified_at, verified_by, recon_note")
    .in("studio_id", studioId ? [studioId] : studioIds)
    .order("created_at", { ascending: false });
  if (locationId) q = q.eq("location_id", locationId);
  if (status) q = q.eq("status", status);
  if (reconStatus) q = q.eq("recon_status", reconStatus);
  if (amountMin) q = q.gte("amount", Number(amountMin));
  if (amountMax) q = q.lte("amount", Number(amountMax));
  if (reference) q = q.ilike("reference_code", `%${reference}%`);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lt("created_at", to);
  const { data: payments } = await q;

  const headers = [
    "payment_id",
    "booking_id",
    "status",
    "recon_status",
    "amount",
    "paid_amount",
    "delta",
    "reference",
    "created_at",
    "customer_confirmed_at",
    "verified_at",
    "operator",
    "recon_note",
  ];
  const rows = (payments ?? []).map((p) => {
    const expected = Number(p.amount ?? 0);
    const paid = Number(p.paid_amount ?? expected);
    return [
      p.id,
      p.booking_id ?? "",
      p.status ?? "",
      p.recon_status ?? "",
      expected.toFixed(2),
      paid.toFixed(2),
      (paid - expected).toFixed(2),
      p.reference_code ?? "",
      p.created_at ?? "",
      p.customer_confirmed_at ?? "",
      p.verified_at ?? "",
      p.verified_by ?? "",
      p.recon_note ?? "",
    ];
  });
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payments-export.csv"`,
    },
  });
}
