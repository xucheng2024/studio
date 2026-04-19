import { DashboardAppLink } from "@/components/DashboardAppLink";
import { PaymentMarkButton } from "@/components/PaymentMarkButton";
import { PaymentCopyButton } from "@/components/PaymentCopyButton";
import { PaymentMatchForm } from "@/components/PaymentMatchForm";
import { InvoiceSendButton } from "@/components/InvoiceSendButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import {
  INVOICE_STATUS_FILTER_OPTIONS,
  PAYMENT_METHOD_FILTER_OPTIONS,
  PAYMENT_STATUS_FILTER_OPTIONS,
  RECON_STATUS_FILTER_OPTIONS,
} from "@/lib/payment-filter-options";
import { resolvePaymentVerificationSlaMin } from "@/lib/payment-verification-sla";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { Download } from "lucide-react";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    view?: "queue" | "recon" | "review";
    status?: string;
    payment_method?: string;
    invoice_status?: string;
    recon_status?: string;
    date_from?: string;
    date_to?: string;
    amount_min?: string;
    amount_max?: string;
    reference?: string;
    q?: string;
  }>;
};

function dayRangeStart(d?: string) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function dayRangeEnd(d?: string) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

function toDateInputValue(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildPaymentStats(
  rows: Array<{
    studio_id: string;
    location_id: string | null;
    status: string;
    payment_method: string | null;
    recon_status: string | null;
    booking_id: string | null;
    amount: number | null;
    paid_amount: number | null;
    created_at: string | null;
    verified_at: string | null;
  }>,
  getSlaMin: (studioId: string, locationId: string | null) => number,
) {
  const nowMs = new Date().getTime();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const todayReceived = rows
    .filter((p) => p.created_at && new Date(p.created_at).getTime() >= todayMs)
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const todayVerified = rows
    .filter((p) => p.verified_at && new Date(p.verified_at).getTime() >= todayMs)
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const mismatchCount = rows.filter((p) => p.recon_status === "mismatch").length;
  const unmatchedCount = rows.filter((p) => !p.booking_id).length;
  const slaOverdueCount = rows.filter(
    (p) =>
      p.status === "pending" &&
      p.created_at &&
      !p.verified_at &&
      nowMs - new Date(p.created_at).getTime() > getSlaMin(p.studio_id, p.location_id) * 60 * 1000,
  ).length;
  const txCount = rows.length;
  const settledRows = rows.filter((p) => p.status === "paid" || p.status === "refunded");
  const paidAmount = settledRows
    .filter((p) => p.status === "paid")
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const refundedAmount = settledRows
    .filter((p) => p.status === "refunded")
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const netAmount = paidAmount - refundedAmount;
  const byMethod = {
    paynow: {
      count: settledRows.filter((p) => (p.payment_method ?? "").toLowerCase() === "paynow").length,
      amount: settledRows
        .filter((p) => (p.payment_method ?? "").toLowerCase() === "paynow")
        .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0) * (p.status === "refunded" ? -1 : 1), 0),
    },
    cash: {
      count: settledRows.filter((p) => (p.payment_method ?? "").toLowerCase() === "cash").length,
      amount: settledRows
        .filter((p) => (p.payment_method ?? "").toLowerCase() === "cash")
        .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0) * (p.status === "refunded" ? -1 : 1), 0),
    },
  };

  return {
    todayReceived,
    todayVerified,
    mismatchCount,
    unmatchedCount,
    slaOverdueCount,
    txCount,
    paidAmount,
    refundedAmount,
    netAmount,
    byMethod,
  };
}

export default async function DashboardPaymentsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const view = sp.view ?? "queue";
  if (studioIds.length === 0) return <p className={ui.muted}>Create your first studio in Overview.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  const activeStudioId = selectedStudioId ?? studioIds[0];
  const todayKey = toDateInputValue(new Date());
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", [activeStudioId])
    .eq("is_active", true)
    .order("name");
  const locationMap = new Map((locations ?? []).map((l) => [l.id, l.name ?? "Unnamed location"]));
  const { data: bookingRuleRows } = await supabase
    .from("booking_rules")
    .select("studio_id, location_id, payment_verification_sla_min")
    .in("studio_id", [activeStudioId]);
  const slaRules = (bookingRuleRows ?? []) as Array<{
    studio_id: string;
    location_id: string | null;
    payment_verification_sla_min: number | null;
  }>;
  const getSlaMin = (studioId: string, locationId: string | null) =>
    resolvePaymentVerificationSlaMin(slaRules, studioId, locationId);
  let dailyQ = supabase
    .from("payments")
    .select("id, status, payment_method, amount, paid_amount")
    .eq("studio_id", activeStudioId)
    .gte("created_at", dayRangeStart(todayKey) ?? new Date().toISOString())
    .lt("created_at", dayRangeEnd(todayKey) ?? new Date().toISOString());
  if (selectedLocationId) dailyQ = dailyQ.eq("location_id", selectedLocationId);
  const { data: dailyRowsRaw } = await dailyQ;
  const dailyRows = dailyRowsRaw ?? [];
  const dailyTxCount = dailyRows.length;
  const dailyPaid = dailyRows
    .filter((p) => p.status === "paid")
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const dailyRefunded = dailyRows
    .filter((p) => p.status === "refunded")
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const dailyNet = dailyPaid - dailyRefunded;
  const dailyPaynowAmount = dailyRows
    .filter((p) => (p.payment_method ?? "").toLowerCase() === "paynow")
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0) * (p.status === "refunded" ? -1 : 1), 0);
  const dailyCashAmount = dailyRows
    .filter((p) => (p.payment_method ?? "").toLowerCase() === "cash")
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0) * (p.status === "refunded" ? -1 : 1), 0);

  let q = supabase
    .from("payments")
    .select(
      "id, studio_id, location_id, client_id, booking_id, guest_name, guest_email, status, payment_method, recon_status, amount, paid_amount, currency, reference_code, recon_note, created_at, expires_at, verified_at, verified_by, invoice_number, invoice_sent_at, invoice_status, invoice_voided_at, invoice_void_reason",
    )
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false })
    .limit(300);
  if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.payment_method) q = q.eq("payment_method", sp.payment_method);
  if (sp.invoice_status) q = q.eq("invoice_status", sp.invoice_status);
  if (sp.recon_status) q = q.eq("recon_status", sp.recon_status);
  if (sp.reference) q = q.ilike("reference_code", `%${sp.reference}%`);
  if (sp.amount_min) q = q.gte("amount", Number(sp.amount_min));
  if (sp.amount_max) q = q.lte("amount", Number(sp.amount_max));
  const from = dayRangeStart(sp.date_from);
  if (from) q = q.gte("created_at", from);
  const to = dayRangeEnd(sp.date_to);
  if (to) q = q.lt("created_at", to);

  const { data: rawPayments } = await q;
  const payments = rawPayments ?? [];
  const bookingIds = [...new Set(payments.map((p) => p.booking_id).filter(Boolean))];
  const clientIds = [...new Set(payments.map((p) => p.client_id).filter(Boolean))];

  const [{ data: bookings }, { data: clients }, { data: clientProfiles }] = await Promise.all([
    bookingIds.length > 0
      ? supabase.from("bookings").select("id, guest_name, guest_email, guest_phone").in("id", bookingIds)
      : Promise.resolve({ data: [] as const }),
    clientIds.length > 0
      ? supabase.from("users").select("id, email").in("id", clientIds)
      : Promise.resolve({ data: [] as const }),
    clientIds.length > 0
      ? supabase.from("user_profiles").select("id, phone").in("id", clientIds)
      : Promise.resolve({ data: [] as const }),
  ]);
  const bookingMap = new Map((bookings ?? []).map((b) => [b.id, b]));
  const clientMap = new Map((clients ?? []).map((u) => [u.id, u.email]));
  const clientPhoneMap = new Map((clientProfiles ?? []).map((u) => [u.id, u.phone]));

  const keyword = (sp.q ?? "").trim().toLowerCase();
  const filtered = payments.filter((p) => {
    if (!keyword) return true;
    const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
    const c = p.client_id ? clientMap.get(p.client_id) : null;
    const cPhone = p.client_id ? clientPhoneMap.get(p.client_id) : null;
    return [
      p.reference_code,
      p.recon_note,
      p.guest_email,
      p.guest_name,
      (p as { guest_phone?: string | null }).guest_phone ?? null,
      booking?.guest_email,
      booking?.guest_name,
      (booking as { guest_phone?: string | null } | null)?.guest_phone ?? null,
      c,
      cPhone,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(keyword));
  });
  let allLocationFiltered = filtered;
  if (selectedLocationId) {
    let allQ = supabase
      .from("payments")
      .select(
        "id, studio_id, location_id, client_id, booking_id, guest_name, guest_email, status, payment_method, recon_status, amount, paid_amount, currency, reference_code, recon_note, created_at, expires_at, verified_at, verified_by, invoice_number, invoice_sent_at, invoice_status, invoice_voided_at, invoice_void_reason",
      )
      .in("studio_id", [activeStudioId])
      .order("created_at", { ascending: false })
      .limit(1000);
    if (sp.status) allQ = allQ.eq("status", sp.status);
    if (sp.payment_method) allQ = allQ.eq("payment_method", sp.payment_method);
    if (sp.invoice_status) allQ = allQ.eq("invoice_status", sp.invoice_status);
    if (sp.recon_status) allQ = allQ.eq("recon_status", sp.recon_status);
    if (sp.reference) allQ = allQ.ilike("reference_code", `%${sp.reference}%`);
    if (sp.amount_min) allQ = allQ.gte("amount", Number(sp.amount_min));
    if (sp.amount_max) allQ = allQ.lte("amount", Number(sp.amount_max));
    const allFrom = dayRangeStart(sp.date_from);
    if (allFrom) allQ = allQ.gte("created_at", allFrom);
    const allTo = dayRangeEnd(sp.date_to);
    if (allTo) allQ = allQ.lt("created_at", allTo);
    const { data: rawAllPayments } = await allQ;
    const allPayments = rawAllPayments ?? [];
    const allBookingIds = [...new Set(allPayments.map((p) => p.booking_id).filter(Boolean))];
    const allClientIds = [...new Set(allPayments.map((p) => p.client_id).filter(Boolean))];
    const [{ data: allBookings }, { data: allClients }, { data: allClientProfiles }] = await Promise.all([
      allBookingIds.length > 0
        ? supabase.from("bookings").select("id, guest_name, guest_email, guest_phone").in("id", allBookingIds)
        : Promise.resolve({ data: [] as const }),
      allClientIds.length > 0
        ? supabase.from("users").select("id, email").in("id", allClientIds)
        : Promise.resolve({ data: [] as const }),
      allClientIds.length > 0
        ? supabase.from("user_profiles").select("id, phone").in("id", allClientIds)
        : Promise.resolve({ data: [] as const }),
    ]);
    const allBookingMap = new Map((allBookings ?? []).map((b) => [b.id, b]));
    const allClientMap = new Map((allClients ?? []).map((u) => [u.id, u.email]));
    const allClientPhoneMap = new Map((allClientProfiles ?? []).map((u) => [u.id, u.phone]));
    allLocationFiltered = allPayments.filter((p) => {
      if (!keyword) return true;
      const booking = p.booking_id ? allBookingMap.get(p.booking_id) : null;
      const c = p.client_id ? allClientMap.get(p.client_id) : null;
      const cPhone = p.client_id ? allClientPhoneMap.get(p.client_id) : null;
      return [
        p.reference_code,
        p.recon_note,
        p.guest_email,
        p.guest_name,
        (p as { guest_phone?: string | null }).guest_phone ?? null,
        booking?.guest_email,
        booking?.guest_name,
        (booking as { guest_phone?: string | null } | null)?.guest_phone ?? null,
        c,
        cPhone,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(keyword));
    });
  }

  const nowMs = new Date().getTime();
  // Show pending AND recently-expired payments (within 24 h) so staff can
  // force-confirm payments that expired before they were processed.
  const queueRows = filtered.filter(
    (p) =>
      p.status === "pending" ||
      (p.status === "expired" &&
        p.created_at != null &&
        nowMs - new Date(p.created_at).getTime() < 24 * 60 * 60 * 1000),
  );
  const reconRows = filtered.filter(
    (p) =>
      p.recon_status === "mismatch" ||
      p.recon_status === "manual_review" ||
      !p.reference_code ||
      Number(p.paid_amount ?? p.amount ?? 0) !== Number(p.amount ?? 0),
  );
  const reviewRows = filtered.filter((p) => p.status !== "pending" || p.verified_at != null);
  const visible = view === "recon" ? reconRows : view === "review" ? reviewRows : queueRows;

  const scopedStats = buildPaymentStats(filtered, getSlaMin);
  const allLocationStats = selectedLocationId ? buildPaymentStats(allLocationFiltered, getSlaMin) : scopedStats;

  const ids = visible.map((p) => p.id);
  const { data: audits } =
    ids.length > 0
      ? await supabase
          .from("operation_audits")
          .select("id, target_id, action, actor_id, actor_role, created_at")
          .eq("target_type", "payment")
          .in("target_id", ids)
          .order("created_at", { ascending: false })
      : { data: [] as const };
  type PaymentAudit = {
    id: string;
    target_id: string | null;
    action: string;
    actor_id: string | null;
    actor_role: string | null;
    created_at: string;
  };
  const auditMap = new Map<string, PaymentAudit[]>();
  for (const a of (audits ?? []) as PaymentAudit[]) {
    const k = a.target_id ?? "";
    if (!k) continue;
    if (!auditMap.has(k)) auditMap.set(k, []);
    auditMap.get(k)?.push(a);
  }

  const exportParams = new URLSearchParams();
  exportParams.set("studio_id", activeStudioId);
  if (selectedLocationId) exportParams.set("location_id", selectedLocationId);
  exportParams.set("view", view);
  if (sp.status) exportParams.set("status", sp.status);
  if (sp.payment_method) exportParams.set("payment_method", sp.payment_method);
  if (sp.invoice_status) exportParams.set("invoice_status", sp.invoice_status);
  if (sp.recon_status) exportParams.set("recon_status", sp.recon_status);
  if (sp.date_from) exportParams.set("date_from", sp.date_from);
  if (sp.date_to) exportParams.set("date_to", sp.date_to);
  if (sp.amount_min) exportParams.set("amount_min", sp.amount_min);
  if (sp.amount_max) exportParams.set("amount_max", sp.amount_max);
  if (sp.reference) exportParams.set("reference", sp.reference);
  if (sp.q) exportParams.set("q", sp.q);
  const tabHref = (targetView: "queue" | "recon" | "review") => {
    const p = new URLSearchParams(exportParams.toString());
    p.set("view", targetView);
    return `/dashboard/payments?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div>
        <h1 className={ui.h1}>Payment records</h1>
        <p className={`mt-1 ${ui.muted}`}>Check incoming payments, handle exceptions, export records, and view action history.</p>

        {/* Tab bar + actions */}
        <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
          <DashboardAppLink href={`/dashboard/operations?${exportParams.toString()}`} className={ui.btnSecondarySm}>
            ← Operations
          </DashboardAppLink>
          <div className="flex items-center rounded-xl border border-stone-200 bg-stone-50 p-0.5 dark:border-stone-700 dark:bg-stone-900">
            {(["queue", "recon", "review"] as const).map((v) => (
              <DashboardAppLink
                key={v}
                href={tabHref(v)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === v
                    ? "bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-100"
                    : "text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                }`}
              >
                {v === "queue" ? "Pending" : v === "recon" ? "Exceptions" : "Processed"}
              </DashboardAppLink>
            ))}
          </div>
          <a
            className={`${ui.linkMuted} ml-auto inline-flex items-center gap-1.5`}
            href={`/api/payments/export?${exportParams.toString()}`}
          >
            <Download size={13} />
            Export CSV
          </a>
        </div>
      </div>

      {/* ── Stats grid (2 cols on mobile) ───────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Today received</p>
          <p className="mt-1 text-xl font-semibold">${scopedStats.todayReceived.toFixed(2)}</p>
          {selectedLocationId ? (
            <p className={`mt-1 text-xs ${ui.muted}`}>All locations: ${allLocationStats.todayReceived.toFixed(2)}</p>
          ) : null}
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Confirmed today</p>
          <p className="mt-1 text-xl font-semibold">${scopedStats.todayVerified.toFixed(2)}</p>
          {selectedLocationId ? (
            <p className={`mt-1 text-xs ${ui.muted}`}>All locations: ${allLocationStats.todayVerified.toFixed(2)}</p>
          ) : null}
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Amount mismatch</p>
          <p className="mt-1 text-xl font-semibold">{scopedStats.mismatchCount}</p>
          {selectedLocationId ? (
            <p className={`mt-1 text-xs ${ui.muted}`}>All locations: {allLocationStats.mismatchCount}</p>
          ) : null}
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Unlinked payments</p>
          <p className="mt-1 text-xl font-semibold">{scopedStats.unmatchedCount}</p>
          {selectedLocationId ? (
            <p className={`mt-1 text-xs ${ui.muted}`}>All locations: {allLocationStats.unmatchedCount}</p>
          ) : null}
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Overdue</p>
          <p className="mt-1 text-xl font-semibold">{scopedStats.slaOverdueCount}</p>
          {selectedLocationId ? (
            <p className={`mt-1 text-xs ${ui.muted}`}>All locations: {allLocationStats.slaOverdueCount}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Transactions (filtered)</p>
          <p className="mt-1 text-xl font-semibold">{scopedStats.txCount}</p>
          <p className={`mt-1 text-xs ${ui.muted}`}>Paid ${scopedStats.paidAmount.toFixed(2)} · Ref ${scopedStats.refundedAmount.toFixed(2)}</p>
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Net (paid - refunded)</p>
          <p className="mt-1 text-xl font-semibold">${scopedStats.netAmount.toFixed(2)}</p>
          {selectedLocationId ? <p className={`mt-1 text-xs ${ui.muted}`}>All locations: ${allLocationStats.netAmount.toFixed(2)}</p> : null}
        </div>
        <div className={ui.statCard}>
          <p className={`text-xs ${ui.muted}`}>Method split (net)</p>
          <p className={`mt-1 text-sm ${ui.muted}`}>
            PayNow: {scopedStats.byMethod.paynow.count} · ${scopedStats.byMethod.paynow.amount.toFixed(2)}
          </p>
          <p className={`text-sm ${ui.muted}`}>
            Cash: {scopedStats.byMethod.cash.count} · ${scopedStats.byMethod.cash.amount.toFixed(2)}
          </p>
        </div>
      </div>

      <section className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={ui.h2}>Daily close ({todayKey})</h2>
          <a
            className={`${ui.linkMuted} inline-flex items-center gap-1.5`}
            href={`/api/payments/export?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}&date_from=${todayKey}&date_to=${todayKey}`}
          >
            <Download size={13} />
            Export today
          </a>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className={ui.statCard}>
            <p className={`text-xs ${ui.muted}`}>Transactions</p>
            <p className="mt-1 text-xl font-semibold">{dailyTxCount}</p>
          </div>
          <div className={ui.statCard}>
            <p className={`text-xs ${ui.muted}`}>Net</p>
            <p className="mt-1 text-xl font-semibold">${dailyNet.toFixed(2)}</p>
            <p className={`mt-1 text-xs ${ui.muted}`}>Paid ${dailyPaid.toFixed(2)} · Ref ${dailyRefunded.toFixed(2)}</p>
          </div>
          <div className={ui.statCard}>
            <p className={`text-xs ${ui.muted}`}>PayNow net</p>
            <p className="mt-1 text-xl font-semibold">${dailyPaynowAmount.toFixed(2)}</p>
          </div>
          <div className={ui.statCard}>
            <p className={`text-xs ${ui.muted}`}>Cash net</p>
            <p className="mt-1 text-xl font-semibold">${dailyCashAmount.toFixed(2)}</p>
          </div>
        </div>
      </section>

      <form method="get" className={`${ui.card} flex flex-col gap-4`}>
        {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
        <input type="hidden" name="view" value={view} />

        {/* ── Always-visible quick filters ─────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Location</span>
            <select name="location_id" className={ui.select} defaultValue={selectedLocationId ?? ""}>
              <option value="">All locations</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name ?? "Unnamed location"}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Date from</span>
            <input type="date" name="date_from" defaultValue={sp.date_from ?? ""} className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Date to</span>
            <input type="date" name="date_to" defaultValue={sp.date_to ?? ""} className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Search member / ref</span>
            <input name="q" defaultValue={sp.q ?? ""} className={ui.input} placeholder="email, name, ref…" />
          </label>
        </div>

        {/* ── Advanced filters (collapsed) ─────────────────────── */}
        <details className="chevron rounded-lg border border-stone-200 dark:border-stone-700">
          <summary className={`cursor-pointer px-3 py-2 text-sm font-medium ${ui.muted} hover:text-stone-800 dark:hover:text-stone-200`}>
            Advanced filters
            {[sp.status, sp.payment_method, sp.invoice_status, sp.recon_status, sp.amount_min, sp.amount_max, sp.reference].some(Boolean)
              ? <span className="ml-2 rounded-full bg-teal-100 px-1.5 py-0.5 text-xs text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">active</span>
              : null}
          </summary>
          <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Payment status</span>
              <select name="status" className={ui.select} defaultValue={sp.status ?? ""}>
                <option value="">All</option>
                {PAYMENT_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Payment method</span>
              <select name="payment_method" className={ui.select} defaultValue={sp.payment_method ?? ""}>
                <option value="">All</option>
                {PAYMENT_METHOD_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Invoice status</span>
              <select name="invoice_status" className={ui.select} defaultValue={sp.invoice_status ?? ""}>
                <option value="">All</option>
                {INVOICE_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Review status</span>
              <select name="recon_status" className={ui.select} defaultValue={sp.recon_status ?? ""}>
                <option value="">All</option>
                {RECON_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Min amount</span>
              <input type="number" step="0.01" name="amount_min" defaultValue={sp.amount_min ?? ""} className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Max amount</span>
              <input type="number" step="0.01" name="amount_max" defaultValue={sp.amount_max ?? ""} className={ui.input} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Reference code</span>
              <input name="reference" defaultValue={sp.reference ?? ""} className={ui.input} placeholder="Reference code" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={`${ui.label} whitespace-nowrap`}>Search</span>
          <input name="q" defaultValue={sp.q ?? ""} className={ui.input} placeholder="Member / email / note" />
            </label>
          </div>
        </details>

        {/* ── Apply / Reset ─────────────────────────────────── */}
        <div className="flex gap-2">
          <SubmitButton className={ui.btnPrimarySm} pendingText="Applying...">
            Apply filters
          </SubmitButton>
          <DashboardAppLink href={`/dashboard/payments?view=${view}&studio_id=${activeStudioId}`} className={ui.btnGhost}>
            Reset
          </DashboardAppLink>
        </div>
      </form>

      <ul className="flex flex-col gap-3">
        {visible.map((p) => {
          const badges = getUnifiedStatusBadges({ payment_status: p.status, recon_status: p.recon_status });
          const needsReview = p.status === "pending" && p.verified_at == null;
          const rowSlaMin = getSlaMin(p.studio_id, p.location_id ?? null);
          const slaOverdue =
            needsReview &&
            p.created_at != null &&
            nowMs - new Date(p.created_at).getTime() > rowSlaMin * 60 * 1000;
          const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
          const clientEmail = p.client_id ? clientMap.get(p.client_id) : null;
          const clientPhone = p.client_id ? clientPhoneMap.get(p.client_id) : null;
          const displayName = p.guest_name ?? booking?.guest_name ?? null;
          const displayEmail = p.guest_email ?? booking?.guest_email ?? clientEmail ?? null;
          const displayPhone =
            (p as { guest_phone?: string | null }).guest_phone ??
            (booking as { guest_phone?: string | null } | null)?.guest_phone ??
            clientPhone ??
            null;
          const clientLabel = displayName
            ? displayEmail
              ? `${displayName} <${displayEmail}>`
              : displayName
            : displayEmail
              ? `${p.client_id ? "Member" : "Guest"}: ${displayEmail}`
              : p.client_id
                ? `Member · ${p.client_id}`
                : "-";
          const clientLabelWithPhone = displayPhone ? `${clientLabel} · ${displayPhone}` : clientLabel;
          const timeline = (auditMap.get(p.id) ?? []).slice(0, 5);
          return (
            <li
              key={p.id}
              className={`${ui.card} ${
                slaOverdue
                  ? "border-red-300 dark:border-red-800/60"
                  : needsReview
                    ? "border-amber-300 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-950/20"
                    : ""
              }`}
            >
              {/* ── Card header: amount + badges ──────────────────── */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                    {p.currency} {Number(p.amount).toFixed(2)}
                    {Number(p.paid_amount ?? p.amount) !== Number(p.amount) ? (
                      <span className="ml-2 text-sm font-normal text-stone-500">
                        (paid {Number(p.paid_amount).toFixed(2)})
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeToneClass(badges.payment.tone)}`}>
                      {badges.payment.text}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeToneClass(badges.recon.tone)}`}>
                      {badges.recon.text}
                    </span>
                    {slaOverdue ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                        Overdue &gt;{rowSlaMin}m
                      </span>
                    ) : null}
                    {p.invoice_status === "void" ? (
                      <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-300">
                        Invoice voided
                      </span>
                    ) : null}
                  </div>
                </div>
                {/* Copy button top-right */}
                <PaymentCopyButton text={`Amount: ${p.currency} ${Number(p.amount).toFixed(2)}\nRef: ${p.reference_code ?? "-"}`} />
              </div>

              {/* ── Key fields grid ───────────────────────────────── */}
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-stone-400 dark:text-stone-500">Member</dt>
                  <dd className="truncate font-medium text-stone-700 dark:text-stone-300">{clientLabelWithPhone}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-stone-400 dark:text-stone-500">Method</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{p.payment_method ?? "-"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-stone-400 dark:text-stone-500">Ref</dt>
                  <dd><span className={ui.code}>{p.reference_code ?? "-"}</span></dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-stone-400 dark:text-stone-500">Location</dt>
                  <dd className="text-stone-700 dark:text-stone-300">
                    {p.location_id ? (locationMap.get(p.location_id) ?? "Unknown") : "Unassigned"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-stone-400 dark:text-stone-500">Created</dt>
                  <dd className="text-stone-600 dark:text-stone-400">
                    {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
                  </dd>
                </div>
                {p.verified_at ? (
                  <div className="flex gap-2 sm:col-span-2">
                    <dt className="w-16 shrink-0 text-stone-400 dark:text-stone-500">Verified</dt>
                    <dd className="text-stone-600 dark:text-stone-400">
                      {new Date(p.verified_at).toLocaleString()} · {p.verified_by ?? "-"}
                    </dd>
                  </div>
                ) : null}
                {p.recon_note ? (
                  <div className="flex gap-2 sm:col-span-2">
                    <dt className="w-16 shrink-0 text-stone-400 dark:text-stone-500">Note</dt>
                    <dd className="text-stone-600 dark:text-stone-400">{p.recon_note}</dd>
                  </div>
                ) : null}
              </dl>

              {/* ── Invoice info ──────────────────────────────────── */}
              {p.status === "paid" && p.invoice_status !== "void" ? (
                <div className="mt-3 rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-800/30">
                  {p.invoice_number ? (
                    <p className="text-xs text-stone-600 dark:text-stone-400">
                      Invoice <span className={ui.code}>{p.invoice_number}</span>
                      {p.invoice_sent_at
                        ? ` · sent ${new Date(p.invoice_sent_at).toLocaleString()}`
                        : " · not sent"}
                    </p>
                  ) : (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      Invoice number missing — contact support.
                    </p>
                  )}
                </div>
              ) : null}
              {p.status === "refunded" && p.invoice_status === "void" && p.invoice_number ? (
                <div className="mt-3 rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-800/30">
                  <p className="text-xs text-stone-600 dark:text-stone-400">
                    Invoice <span className={ui.code}>{p.invoice_number}</span> voided
                    {p.invoice_voided_at ? ` · ${new Date(p.invoice_voided_at).toLocaleString()}` : ""}
                    {p.invoice_void_reason ? ` · ${p.invoice_void_reason}` : ""}
                  </p>
                </div>
              ) : null}

              {/* ── Audit timeline (collapsed) ────────────────────── */}
              {timeline.length ? (
                <details className="mt-3">
                  <summary className={`cursor-pointer text-xs ${ui.muted}`}>
                    Audit timeline ({timeline.length})
                  </summary>
                  <ul className="mt-2 space-y-1 pl-1">
                    {timeline.map((a) => (
                      <li key={a.id} className={`text-xs ${ui.muted}`}>
                        {new Date(a.created_at).toLocaleString()} · {a.action} · {a.actor_role ?? "staff"}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {/* ── Action buttons ────────────────────────────────── */}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
                {p.status === "pending" ? (
                  <>
                    <PaymentMarkButton paymentId={p.id} status="paid" label="Mark paid" />
                    <PaymentMarkButton paymentId={p.id} status="failed" label="Mark failed" />
                    <PaymentMarkButton paymentId={p.id} status="expired" label="Mark expired" />
                  </>
                ) : null}
                {p.status === "expired" ? (
                  <PaymentMarkButton paymentId={p.id} status="paid" label="Mark paid (override)" />
                ) : null}
                {p.status === "paid" && p.invoice_status !== "void" ? <InvoiceSendButton paymentId={p.id} /> : null}
                {p.status === "paid" ? <PaymentMarkButton paymentId={p.id} status="refunded" label="Mark refunded" /> : null}
                {!p.booking_id ? <PaymentMatchForm paymentId={p.id} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {!visible.length ? (
        <div className={ui.emptyState}>
          <p className={`font-medium ${ui.muted}`}>No payments match this filter.</p>
          <p className={`text-xs ${ui.muted}`}>Try adjusting the filters above.</p>
        </div>
      ) : null}
    </div>
  );
}
