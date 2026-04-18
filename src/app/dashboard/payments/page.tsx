import { DashboardAppLink } from "@/components/DashboardAppLink";
import { PaymentMarkButton } from "@/components/PaymentMarkButton";
import { PaymentCopyButton } from "@/components/PaymentCopyButton";
import { PaymentMatchForm } from "@/components/PaymentMatchForm";
import { InvoiceSendButton } from "@/components/InvoiceSendButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { PAYMENT_STATUS_FILTER_OPTIONS, RECON_STATUS_FILTER_OPTIONS } from "@/lib/payment-filter-options";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    view?: "queue" | "recon" | "review";
    status?: string;
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
  if (studioIds.length === 0) return <p className={ui.muted}>Create a studio from the overview first.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have payment access.</p>;
  }

  let q = supabase
    .from("payments")
    .select(
      "id, studio_id, location_id, client_id, booking_id, status, recon_status, amount, paid_amount, currency, reference_code, recon_note, created_at, expires_at, customer_confirmed_at, customer_confirmation_note, verified_at, verified_by, invoice_number, invoice_sent_at",
    )
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false })
    .limit(300);
  if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
  if (sp.status) q = q.eq("status", sp.status);
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
  const { data: bookings } =
    bookingIds.length > 0
      ? await supabase.from("bookings").select("id, guest_name, guest_email").in("id", bookingIds)
      : { data: [] as const };
  const { data: clients } =
    clientIds.length > 0
      ? await supabase.from("users").select("id, email").in("id", clientIds)
      : { data: [] as const };
  const bookingMap = new Map((bookings ?? []).map((b) => [b.id, b]));
  const clientMap = new Map((clients ?? []).map((u) => [u.id, u.email]));

  const keyword = (sp.q ?? "").trim().toLowerCase();
  const filtered = payments.filter((p) => {
    if (!keyword) return true;
    const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
    const c = p.client_id ? clientMap.get(p.client_id) : null;
    return [p.reference_code, p.recon_note, booking?.guest_email, booking?.guest_name, c]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(keyword));
  });

  const nowMs = new Date().getTime();
  const queueRows = filtered.filter(
    (p) =>
      p.status === "pending" &&
      (p.recon_status === "awaiting_verification" || p.customer_confirmed_at != null || !p.booking_id),
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const todayReceived = filtered
    .filter((p) => p.customer_confirmed_at && new Date(p.customer_confirmed_at).getTime() >= todayMs)
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const todayVerified = filtered
    .filter((p) => p.verified_at && new Date(p.verified_at).getTime() >= todayMs)
    .reduce((a, p) => a + Number(p.paid_amount ?? p.amount ?? 0), 0);
  const mismatchCount = filtered.filter((p) => p.recon_status === "mismatch").length;
  const unmatchedCount = filtered.filter((p) => !p.booking_id).length;
  const slaOverdueCount = filtered.filter(
    (p) =>
      p.status === "pending" &&
      p.customer_confirmed_at &&
      !p.verified_at &&
      nowMs - new Date(p.customer_confirmed_at).getTime() > 10 * 60 * 1000,
  ).length;

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
  exportParams.set("studio_id", selectedStudioId ?? studioIds[0]);
  if (selectedLocationId) exportParams.set("location_id", selectedLocationId);
  exportParams.set("view", view);
  if (sp.status) exportParams.set("status", sp.status);
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
      <div>
        <h1 className={ui.h1}>Payment records</h1>
        <p className={ui.muted}>Track incoming payments, review issues, export reports, and check action history.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <DashboardAppLink
            className={view === "queue" ? ui.link : ui.linkMuted}
            href={tabHref("queue")}
          >
            To confirm
          </DashboardAppLink>
          <DashboardAppLink
            className={view === "recon" ? ui.link : ui.linkMuted}
            href={tabHref("recon")}
          >
            Needs review
          </DashboardAppLink>
          <DashboardAppLink
            className={view === "review" ? ui.link : ui.linkMuted}
            href={tabHref("review")}
          >
            Completed
          </DashboardAppLink>
          <a
            className={`${ui.linkMuted} transition-opacity duration-100 active:opacity-60`}
            href={`/api/payments/export?${exportParams.toString()}`}
          >
            Export payments CSV
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-5">
        <div className={ui.statCard}><p className={`text-xs ${ui.muted}`}>Today received</p><p className="mt-1 text-xl font-semibold">${todayReceived.toFixed(2)}</p></div>
        <div className={ui.statCard}><p className={`text-xs ${ui.muted}`}>Today confirmed by staff</p><p className="mt-1 text-xl font-semibold">${todayVerified.toFixed(2)}</p></div>
        <div className={ui.statCard}><p className={`text-xs ${ui.muted}`}>Amount mismatch</p><p className="mt-1 text-xl font-semibold">{mismatchCount}</p></div>
        <div className={ui.statCard}><p className={`text-xs ${ui.muted}`}>Without booking link</p><p className="mt-1 text-xl font-semibold">{unmatchedCount}</p></div>
        <div className={ui.statCard}><p className={`text-xs ${ui.muted}`}>Confirmation overdue</p><p className="mt-1 text-xl font-semibold">{slaOverdueCount}</p></div>
      </div>

      <form method="get" className={`${ui.card} grid gap-3 md:grid-cols-4`}>
        {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
        <input type="hidden" name="view" value={view} />
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Payment status</span>
          <select name="status" className={ui.select} defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {PAYMENT_STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Payment review status</span>
          <select name="recon_status" className={ui.select} defaultValue={sp.recon_status ?? ""}>
            <option value="">All</option>
            {RECON_STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <input type="date" name="date_from" defaultValue={sp.date_from ?? ""} className={ui.input} />
        <input type="date" name="date_to" defaultValue={sp.date_to ?? ""} className={ui.input} />
        <input type="number" step="0.01" name="amount_min" defaultValue={sp.amount_min ?? ""} className={ui.input} placeholder="Min amount" />
        <input type="number" step="0.01" name="amount_max" defaultValue={sp.amount_max ?? ""} className={ui.input} placeholder="Max amount" />
        <input name="reference" defaultValue={sp.reference ?? ""} className={ui.input} placeholder="Reference code" />
        <input name="q" defaultValue={sp.q ?? ""} className={ui.input} placeholder="Member/email/notes keyword" />
        <div className="md:col-span-4 flex gap-2">
          <SubmitButton className={ui.btnPrimarySm} pendingText="Applying...">
            Apply filters
          </SubmitButton>
          <DashboardAppLink href={`/dashboard/payments?view=${view}`} className={ui.btnGhost}>
            Reset
          </DashboardAppLink>
        </div>
      </form>

      <ul className="flex flex-col gap-3">
        {visible.map((p) => {
          const badges = getUnifiedStatusBadges({ payment_status: p.status, recon_status: p.recon_status });
          const needsReview = p.status === "pending" && p.customer_confirmed_at != null && p.verified_at == null;
          const slaOverdue =
            needsReview && nowMs - new Date(p.customer_confirmed_at ?? 0).getTime() > 10 * 60 * 1000;
          const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
          const clientEmail = p.client_id ? clientMap.get(p.client_id) : null;
          const clientLabel = clientEmail ?? booking?.guest_email ?? booking?.guest_name ?? p.client_id ?? "-";
          const timeline = (auditMap.get(p.id) ?? []).slice(0, 5);
          return (
            <li
              key={p.id}
              className={`${ui.card} ${needsReview ? "border-amber-300 bg-amber-50/50 dark:border-amber-700/70 dark:bg-amber-950/20" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-stone-900 dark:text-stone-100">
                    {p.currency} {Number(p.amount).toFixed(2)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${badgeToneClass(badges.payment.tone)}`}>{badges.payment.text}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${badgeToneClass(badges.recon.tone)}`}>{badges.recon.text}</span>
                  </div>
                  <p className={ui.muted}>Client: {clientLabel}</p>
                  <p className={ui.muted}>Ref: <span className={ui.code}>{p.reference_code ?? "-"}</span></p>
                  <p className={ui.muted}>Review status: {p.recon_status} · Paid amount: {p.currency} {Number(p.paid_amount ?? p.amount).toFixed(2)}</p>
                  {p.invoice_number ? (
                    <p className={ui.muted}>
                      Invoice: <span className={ui.code}>{p.invoice_number}</span>
                      {p.invoice_sent_at
                        ? ` · sent ${new Date(p.invoice_sent_at).toLocaleString()}`
                        : " · not sent yet"}
                    </p>
                  ) : null}
                  {p.recon_note ? <p className={ui.muted}>Review note: {p.recon_note}</p> : null}
                  <p className={ui.muted}>Created: {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}</p>
                  <p className={ui.muted}>Customer payment notice: {p.customer_confirmed_at ? new Date(p.customer_confirmed_at).toLocaleString() : "not submitted"}</p>
                  {p.verified_at ? <p className={ui.muted}>Verified: {new Date(p.verified_at).toLocaleString()} · By {p.verified_by ?? "-"}</p> : null}
                  {slaOverdue ? <p className="text-xs font-medium text-red-600 dark:text-red-400">Confirmation overdue (&gt;10m)</p> : null}
                  {timeline.length ? (
                    <div className="mt-2 rounded-lg border border-stone-200 p-2 text-xs dark:border-stone-700">
                      <p className={`mb-1 font-medium ${ui.muted}`}>Audit timeline</p>
                      <ul className="space-y-1">
                        {timeline.map((a) => (
                          <li key={a.id} className={ui.muted}>
                            {new Date(a.created_at).toLocaleString()} · {a.action} · {a.actor_role ?? "staff"} · {a.actor_id ?? "system"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <PaymentCopyButton text={`Amount: ${p.currency} ${Number(p.amount).toFixed(2)}\nRef: ${p.reference_code ?? "-"}`} />
                  {p.status === "pending" ? (
                    <>
                      <PaymentMarkButton paymentId={p.id} status="paid" label="Mark paid" />
                      <PaymentMarkButton paymentId={p.id} status="failed" label="Mark failed" />
                      <PaymentMarkButton paymentId={p.id} status="expired" label="Mark expired" />
                    </>
                  ) : null}
                  {p.status === "paid" ? <InvoiceSendButton paymentId={p.id} /> : null}
                  {p.status === "paid" ? <PaymentMarkButton paymentId={p.id} status="refunded" label="Mark refunded" /> : null}
                  {!p.booking_id ? <PaymentMatchForm paymentId={p.id} /> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!visible.length ? <p className={ui.muted}>No payments match this filter.</p> : null}
    </div>
  );
}
