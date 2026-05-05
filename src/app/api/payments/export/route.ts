import { NextResponse } from "next/server";
import { dayRangeEndExclusiveIso, dayRangeStartIso, localISODate } from "@/lib/date";
import { bestRole, buildAccessContext } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replaceAll("\"", "\"\"")}"`;
  }
  return s;
}

type PaymentRow = {
  id: string;
  booking_id: string | null;
  client_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  status: string | null;
  payment_method: string | null;
  recon_status: string | null;
  amount: number | null;
  paid_amount: number | null;
  currency: string | null;
  reference_code: string | null;
  created_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  recon_note: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_voided_at?: string | null;
  invoice_void_reason?: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const studioId = url.searchParams.get("studio_id");
  const locationId = url.searchParams.get("location_id");
  const paymentMethod = url.searchParams.get("payment_method");
  const dateFromParam = url.searchParams.get("date_from");
  const dateToParam = url.searchParams.get("date_to");

  // Default to last 30 days when no date range supplied, preventing unbounded full-table exports.
  const fallbackTo = new Date();
  const fallbackFrom = new Date(fallbackTo);
  fallbackFrom.setDate(fallbackFrom.getDate() - 30);

  const from = dateFromParam
    ? dayRangeStartIso(dateFromParam)
    : fallbackFrom.toISOString();
  const to = dateToParam
    ? dayRangeEndExclusiveIso(dateToParam)
    : fallbackTo.toISOString();
  const keyword = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ctx = await buildAccessContext(user.id, user.email ?? null, null);
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
    .select(
      "id, booking_id, client_id, guest_name, guest_email, status, payment_method, recon_status, amount, paid_amount, currency, reference_code, created_at, verified_at, verified_by, recon_note, invoice_number, invoice_status, invoice_voided_at, invoice_void_reason",
    )
    .in("studio_id", studioId ? [studioId] : studioIds)
    .order("created_at", { ascending: false })
    .limit(5000); // Hard cap: export larger datasets via date-range pagination
  if (locationId) q = q.eq("location_id", locationId);
  if (paymentMethod) q = q.eq("payment_method", paymentMethod);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lt("created_at", to);
  const { data: payments } = await q;
  let rows: PaymentRow[] = (payments ?? []) as PaymentRow[];

  // Fetch related bookings and users for keyword search & operator email resolution
  const bookingIds = [...new Set(rows.map((p) => p.booking_id).filter(Boolean))] as string[];
  const clientIds = [...new Set(rows.map((p) => p.client_id).filter(Boolean))] as string[];
  const operatorIds = [...new Set(rows.map((p) => p.verified_by).filter(Boolean))] as string[];
  const allUserIds = [...new Set([...clientIds, ...operatorIds])];

  const [{ data: bookings }, { data: userRows }] = await Promise.all([
    bookingIds.length > 0
      ? supabase.from("bookings").select("id, guest_name, guest_email").in("id", bookingIds)
      : Promise.resolve({ data: [] as const }),
    allUserIds.length > 0
      ? supabase.from("users").select("id, email").in("id", allUserIds)
      : Promise.resolve({ data: [] as const }),
  ]);

  const bookingMap = new Map((bookings ?? []).map((b) => [b.id, b]));
  const userEmailMap = new Map((userRows ?? []).map((u) => [u.id, u.email ?? ""]));

  // Apply keyword filter (mirrors payments page logic)
  if (keyword) {
    rows = rows.filter((p) => {
      const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
      const clientEmail = p.client_id ? userEmailMap.get(p.client_id) : null;
      return [
        p.reference_code,
        p.recon_note,
        p.guest_email,
        p.guest_name,
        booking?.guest_email,
        booking?.guest_name,
        clientEmail,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(keyword));
    });
  }

  const headers = [
    "payment_id",
    "booking_id",
    "payment_status",
    "payment_method",
    "invoice_status",
    "invoice_number",
    "invoice_voided_at",
    "invoice_void_reason",
    "recon_status",
    "amount",
    "paid_amount",
    "delta",
    "reference",
    "created_at",
    "submitted_at",
    "verified_at",
    "operator_email",
    "recon_note",
  ];
  const csvRows = rows.map((p) => {
    const expected = Number(p.amount ?? 0);
    const paid = Number(p.paid_amount ?? expected);
    const operatorEmail = p.verified_by ? (userEmailMap.get(p.verified_by) ?? p.verified_by) : "";
    return [
      p.id,
      p.booking_id ?? "",
      p.status ?? "",
      p.payment_method ?? "",
      p.invoice_status ?? "",
      p.invoice_number ?? "",
      p.invoice_voided_at ?? "",
      p.invoice_void_reason ?? "",
      p.recon_status ?? "",
      expected.toFixed(2),
      paid.toFixed(2),
      (paid - expected).toFixed(2),
      p.reference_code ?? "",
      p.created_at ?? "",
      p.created_at ?? "",
      p.verified_at ?? "",
      operatorEmail,
      p.recon_note ?? "",
    ];
  });
  const EXPORT_CAP = 5000;
  const wasCapped = (payments ?? []).length >= EXPORT_CAP;
  // Warning goes at the END so that the header row always stays on line 1.
  // BI tools and accounting software treat the first row as column names;
  // prepending a comment row would shift all fields by one column.
  // The x-export-capped response header already signals truncation to API callers.
  const capWarningRow = wasCapped
    ? [["# WARNING: export capped at 5000 rows — narrow the date range for a complete export"]]
    : [];

  const csv = [headers, ...csvRows, ...capWarningRow].map((r) => r.map(csvEscape).join(",")).join("\n");
  const dateLabel =
    dateFromParam && dateToParam
      ? `${dateFromParam}_${dateToParam}`
      : `last30d_${localISODate()}`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payments-${dateLabel}.csv"`,
      "x-export-row-count": String(rows.length),
      "x-export-capped": String(wasCapped),
    },
  });
}
