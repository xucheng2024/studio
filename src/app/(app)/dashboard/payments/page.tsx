import { DashboardAppLink } from "@/components/DashboardAppLink";
import { PaymentMarkButton } from "@/components/PaymentMarkButton";
import { PaymentCopyButton } from "@/components/PaymentCopyButton";
import { InvoiceSendButton } from "@/components/InvoiceSendButton";
import { SubmitButton } from "@/components/SubmitButton";
import { dayRangeEndExclusiveIso, dayRangeStartIso, localISODate } from "@/lib/date";
import { LocalTime } from "@/components/ui/LocalTime";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { hasStudioRole } from "@/lib/rbac";
import {
  PAYMENT_METHOD_FILTER_OPTIONS,
  PAYMENT_SOURCE_FILTER_OPTIONS,
} from "@/lib/payment-filter-options";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { Download, Gift } from "lucide-react";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    payment_method?: string;
    source?: string;
    date_from?: string;
    date_to?: string;
    q?: string;
  }>;
};

function paymentSourceLabel(source: string | null | undefined) {
  switch (source) {
    case "walkin":
      return "Walk-in";
    case "package_buy":
      return "Package purchase";
    case "online_booking":
      return "Session booking";
    case "event_booking":
      return "Event booking";
    case "membership_subscription":
      return "Membership subscription";
    case "member_zone_purchase":
      return "Member zone purchase";
    case "shop_purchase":
      return "Shop purchase";
    default:
      return "Unknown";
  }
}

function paymentMethodLabel(method: string | null | undefined) {
  const m = (method ?? "").toLowerCase();
  if (m === "hitpay") return "HitPay";
  if (m === "free") return "Free";
  if (m === "cash") return "Cash";
  if (m === "card") return "Card";
  if (m === "paynow") return "PayNow";
  if (m === "bank_transfer" || m === "transfer" || m === "bank") return "Bank transfer";
  if (!method) return "-";
  return method;
}

export default async function DashboardPaymentsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  }, ["owner", "manager", "frontdesk"]);
  if (studioIds.length === 0) return <p className={ui.muted}>You do not have access to this page.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const activeStudioId = selectedStudioId ?? studioIds[0];
  const canRefundPayments = hasStudioRole(ctx, activeStudioId, ["owner", "manager"]);
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", [activeStudioId])
    .eq("is_active", true)
    .order("name");
  const locationMap = new Map((locations ?? []).map((l) => [l.id, l.name ?? "Unnamed location"]));

  let q = supabase
    .from("payments")
    .select(
      "id, studio_id, location_id, client_id, booking_id, event_booking_id, package_id, membership_product_id, customer_subscription_id, member_zone_series_id, member_zone_lesson_id, shop_product_id, guest_name, guest_email, guest_phone, is_gift, gift_recipient_name, gift_recipient_email, gift_message, status, payment_method, source, amount, currency, reference_code, created_at, expires_at, verified_at, verified_by, invoice_number, invoice_sent_at, invoice_status, invoice_voided_at, invoice_void_reason, package_name_snapshot, membership_name_snapshot, shop_product_name_snapshot",
    )
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false })
    .limit(300);
  if (selectedLocationId) q = q.eq("location_id", selectedLocationId);
  if (sp.payment_method) q = q.eq("payment_method", sp.payment_method);
  if (sp.source) q = q.eq("source", sp.source);
  const defaultDate = localISODate();
  const dateFrom = sp.date_from ?? defaultDate;
  const dateTo = sp.date_to ?? defaultDate;
  const from = dayRangeStartIso(dateFrom);
  if (from) q = q.gte("created_at", from);
  const to = dayRangeEndExclusiveIso(dateTo);
  if (to) q = q.lt("created_at", to);

  const { data: rawPayments } = await q;
  const payments = rawPayments ?? [];
  const bookingIds = [...new Set(payments.map((p) => p.booking_id).filter(Boolean))];
  const eventBookingIds = [...new Set(payments.map((p) => (p as { event_booking_id?: string | null }).event_booking_id).filter(Boolean))];
  const clientIds = [...new Set(payments.map((p) => p.client_id).filter(Boolean))];
  const packageIds = [...new Set(payments.map((p) => (p as { package_id?: string | null }).package_id).filter(Boolean))];
  const memberZoneSeriesIds = [...new Set(payments.map((p) => (p as { member_zone_series_id?: string | null }).member_zone_series_id).filter(Boolean))];
  const memberZoneLessonIds = [...new Set(payments.map((p) => (p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id).filter(Boolean))];

  const [{ data: bookings }, { data: eventBookings }, { data: packageRows }, { data: memberZoneSeriesRows }, { data: memberZoneLessonRows }, { data: clients }, { data: clientProfiles }] = await Promise.all([
    bookingIds.length > 0
      ? supabase
          .from("bookings")
          .select("id, guest_name, guest_email, guest_phone, class_sessions(start_time, classes(title))")
          .in("id", bookingIds)
      : Promise.resolve({ data: [] as const }),
    eventBookingIds.length > 0
      ? supabase
          .from("event_bookings")
          .select("id, guest_name, guest_email, guest_phone, events(title, start_time)")
          .in("id", eventBookingIds)
      : Promise.resolve({ data: [] as const }),
    packageIds.length > 0
      ? supabase
          .from("packages")
          .select("id, name")
          .in("id", packageIds)
      : Promise.resolve({ data: [] as const }),
    memberZoneSeriesIds.length > 0
      ? supabase
          .from("member_zone_series")
          .select("id, title")
          .in("id", memberZoneSeriesIds)
      : Promise.resolve({ data: [] as const }),
    memberZoneLessonIds.length > 0
      ? supabase
          .from("member_zone_lessons")
          .select("id, title")
          .in("id", memberZoneLessonIds)
      : Promise.resolve({ data: [] as const }),
    clientIds.length > 0
      ? supabase.from("users").select("id, email").in("id", clientIds)
      : Promise.resolve({ data: [] as const }),
    clientIds.length > 0
      ? admin.from("user_profiles").select("id, phone, full_name").in("id", clientIds)
      : Promise.resolve({ data: [] as const }),
  ]);
  const bookingMap = new Map((bookings ?? []).map((b) => [b.id, b]));
  const eventBookingMap = new Map((eventBookings ?? []).map((b) => [b.id, b]));
  const packageMap = new Map((packageRows ?? []).map((pkg) => [pkg.id, pkg]));
  const memberZoneSeriesMap = new Map((memberZoneSeriesRows ?? []).map((row) => [row.id, row]));
  const memberZoneLessonMap = new Map((memberZoneLessonRows ?? []).map((row) => [row.id, row]));
  const clientMap = new Map((clients ?? []).map((u) => [u.id, u.email]));
  const clientProfileMap = new Map(
    (clientProfiles ?? []).map((u) => [
      u.id,
      {
        phone: u.phone ?? null,
        full_name: (u as { full_name?: string | null }).full_name ?? null,
      },
    ]),
  );

  const keyword = (sp.q ?? "").trim().toLowerCase();
  const filtered = payments.filter((p) => {
    if (!keyword) return true;
    const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
    const c = p.client_id ? clientMap.get(p.client_id) : null;
    const cProfile = p.client_id ? clientProfileMap.get(p.client_id) : null;
    const cPhone = cProfile?.phone ?? null;
    const cName = cProfile?.full_name ?? null;
    const eventBooking = (p as { event_booking_id?: string | null }).event_booking_id
      ? eventBookingMap.get((p as { event_booking_id?: string | null }).event_booking_id ?? "")
      : null;
    const pkg = (p as { package_id?: string | null }).package_id
      ? packageMap.get((p as { package_id?: string | null }).package_id ?? "")
      : null;
    const memberZoneSeries = (p as { member_zone_series_id?: string | null }).member_zone_series_id
      ? memberZoneSeriesMap.get((p as { member_zone_series_id?: string | null }).member_zone_series_id ?? "")
      : null;
    const memberZoneLesson = (p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id
      ? memberZoneLessonMap.get((p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id ?? "")
      : null;
    const sessionObj = booking
      ? ((Array.isArray((booking as { class_sessions?: unknown }).class_sessions)
          ? (booking as { class_sessions?: unknown[] }).class_sessions?.[0]
          : (booking as { class_sessions?: unknown }).class_sessions) as
          | {
              classes?: { title?: string | null } | { title?: string | null }[] | null;
            }
          | null)
      : null;
    const sessionClass = Array.isArray(sessionObj?.classes) ? sessionObj?.classes[0] : sessionObj?.classes;
    const sessionTitle = sessionClass?.title ?? null;
    const eventObj = eventBooking
      ? ((Array.isArray((eventBooking as { events?: unknown }).events)
          ? (eventBooking as { events?: unknown[] }).events?.[0]
          : (eventBooking as { events?: unknown }).events) as
          | { title?: string | null }
          | null)
      : null;
    const eventTitle = eventObj?.title ?? null;
    return [
      p.reference_code,
      p.guest_email,
      p.guest_name,
      (p as { guest_phone?: string | null }).guest_phone ?? null,
      booking?.guest_email,
      booking?.guest_name,
      (booking as { guest_phone?: string | null } | null)?.guest_phone ?? null,
      c,
      cPhone,
      cName,
      sessionTitle,
      eventTitle,
      memberZoneSeries?.title ?? null,
      memberZoneLesson?.title ?? null,
      (p as { package_name_snapshot?: string | null }).package_name_snapshot ?? pkg?.name ?? null,
      (p as { membership_name_snapshot?: string | null }).membership_name_snapshot ?? null,
      (p as { shop_product_name_snapshot?: string | null }).shop_product_name_snapshot ?? null,
      (p as { gift_recipient_email?: string | null }).gift_recipient_email ?? null,
      (p as { gift_recipient_name?: string | null }).gift_recipient_name ?? null,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(keyword));
  });
  const visible = filtered;

  const ids = visible.map((p) => p.id);
  const { data: audits } =
    ids.length > 0
      ? await admin
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
  if (sp.payment_method) exportParams.set("payment_method", sp.payment_method);
  if (sp.source) exportParams.set("source", sp.source);
  exportParams.set("date_from", dateFrom);
  exportParams.set("date_to", dateTo);
  if (sp.q) exportParams.set("q", sp.q);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div>
        <h1 className={ui.h1}>Payment records</h1>
        <p className={`mt-1 ${ui.muted}`}>Check incoming payments, export records, and view action history.</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
          <a
            className={`${ui.linkMuted} w-full pt-1 sm:ml-auto sm:w-auto sm:pt-0 inline-flex items-center gap-1.5`}
            href={`/api/payments/export?${exportParams.toString()}`}
          >
            <Download size={13} />
            Export CSV
          </a>
        </div>
      </div>

      <form method="get" className={`${ui.card} flex flex-col gap-4`}>
        {activeStudioId ? <input type="hidden" name="studio_id" value={activeStudioId} /> : null}
        {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}

        {/* ── Always-visible quick filters ─────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Date from</span>
            <input type="date" name="date_from" defaultValue={dateFrom} className={ui.input} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Date to</span>
            <input type="date" name="date_to" defaultValue={dateTo} className={ui.input} />
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
            <span className={ui.label}>Order type</span>
            <select name="source" className={ui.select} defaultValue={sp.source ?? ""}>
              <option value="">All</option>
              {PAYMENT_SOURCE_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Search member / session / event / membership / ref</span>
          <input name="q" defaultValue={sp.q ?? ""} className={ui.input} placeholder="member name, session title, event title, membership name, email, ref…" />
        </label>

        {/* ── Apply / Reset ─────────────────────────────────── */}
        <div className={`${ui.mobileActionBar} flex flex-col gap-2 sm:flex-row`}>
          <SubmitButton className={ui.btnPrimarySm} pendingText="Applying...">
            Apply filters
          </SubmitButton>
          <DashboardAppLink
            href={`/dashboard/payments?studio_id=${activeStudioId}${selectedLocationId ? `&location_id=${selectedLocationId}` : ""}`}
            className={ui.btnGhost}
          >
            Clear filters
          </DashboardAppLink>
        </div>
      </form>

      <ul className="flex flex-col gap-3">
        {visible.map((p) => {
          const badges = getUnifiedStatusBadges({ payment_status: p.status });
          const needsReview = p.status === "pending" && p.verified_at == null;
          const booking = p.booking_id ? bookingMap.get(p.booking_id) : null;
          const eventBooking = (p as { event_booking_id?: string | null }).event_booking_id
            ? eventBookingMap.get((p as { event_booking_id?: string | null }).event_booking_id ?? "")
            : null;
          const pkg = (p as { package_id?: string | null }).package_id
            ? packageMap.get((p as { package_id?: string | null }).package_id ?? "")
            : null;
          const sessionObj = booking
            ? ((Array.isArray((booking as { class_sessions?: unknown }).class_sessions)
                ? (booking as { class_sessions?: unknown[] }).class_sessions?.[0]
                : (booking as { class_sessions?: unknown }).class_sessions) as
                | {
                    start_time?: string | null;
                    classes?: { title?: string | null } | { title?: string | null }[] | null;
                  }
                | null)
            : null;
          const sessionClass = Array.isArray(sessionObj?.classes) ? sessionObj?.classes[0] : sessionObj?.classes;
          const sessionTitle = sessionClass?.title?.trim() || null;
          const sessionStartIso = sessionObj?.start_time ? String(sessionObj.start_time) : null;
          const eventObj = eventBooking
            ? ((Array.isArray((eventBooking as { events?: unknown }).events)
                ? (eventBooking as { events?: unknown[] }).events?.[0]
                : (eventBooking as { events?: unknown }).events) as
                | { title?: string | null; start_time?: string | null }
                | null)
            : null;
          const eventTitle = eventObj?.title?.trim() || null;
          const eventStartIso = eventObj?.start_time ? String(eventObj.start_time) : null;
          const packageLabel =
            (p as { package_name_snapshot?: string | null }).package_name_snapshot?.trim() ||
            pkg?.name?.trim() ||
            "-";
          const membershipLabel =
            (p as { membership_name_snapshot?: string | null }).membership_name_snapshot?.trim() ||
            "-";
          const shopLabel =
            (p as { shop_product_name_snapshot?: string | null }).shop_product_name_snapshot?.trim() ||
            "-";
          const memberZoneSeries = (p as { member_zone_series_id?: string | null }).member_zone_series_id
            ? memberZoneSeriesMap.get((p as { member_zone_series_id?: string | null }).member_zone_series_id ?? "")
            : null;
          const memberZoneLesson = (p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id
            ? memberZoneLessonMap.get((p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id ?? "")
            : null;
          const memberZoneSeriesLabel = memberZoneSeries?.title?.trim() || "-";
          const memberZoneLessonLabel = memberZoneLesson?.title?.trim() || "-";
          const source = (p as { source?: string | null }).source ?? null;
          const orderTypeLabel =
            source === "event_booking"
              ? "Event"
              : source === "membership_subscription"
                ? "Membership"
              : source === "member_zone_purchase"
                ? "Member zone"
              : source === "package_buy"
                ? "Package"
              : source === "shop_purchase"
                ? "Shop"
                : "Session";
          const clientEmail = p.client_id ? clientMap.get(p.client_id) : null;
          const clientProfile = p.client_id ? clientProfileMap.get(p.client_id) : null;
          const clientPhone = clientProfile?.phone ?? null;
          const clientFullName = clientProfile?.full_name ?? null;
          const displayName = p.guest_name ?? booking?.guest_name ?? clientFullName ?? null;
          const displayEmail = p.guest_email ?? booking?.guest_email ?? clientEmail ?? null;
          const displayPhone =
            (p as { guest_phone?: string | null }).guest_phone ??
            (booking as { guest_phone?: string | null } | null)?.guest_phone ??
            clientPhone ??
            null;
          const emailLabel = displayEmail ?? (p.client_id ? clientMap.get(p.client_id) : null) ?? "-";
          const nameLabel = displayName?.trim() || "-";
          const phoneLabel = displayPhone?.trim() || "-";
          const timeline = (auditMap.get(p.id) ?? []).slice(0, 5);
          return (
            <li
              key={p.id}
              className={`${ui.card} ${
                needsReview
                    ? "border-amber-300 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-950/20"
                    : ""
              }`}
            >
              {/* ── Card header: amount + badges ──────────────────── */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                    {p.currency} {Number(p.amount).toFixed(2)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className={ui.badgeNeutral}>{orderTypeLabel}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeToneClass(badges.payment.tone)}`}>
                      {badges.payment.text}
                    </span>
                    {(p as { is_gift?: boolean }).is_gift ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                        <Gift size={10} />
                        Gift
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
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Email</dt>
                  <dd className="min-w-0 break-all font-medium text-stone-700 dark:text-stone-300">{emailLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Class</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">
                    {sessionTitle ? <>{sessionTitle}{sessionStartIso ? <> · <LocalTime iso={sessionStartIso} /></> : null}</> : "-"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Name</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">{nameLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Method</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{paymentMethodLabel(p.payment_method)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Source</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{paymentSourceLabel((p as { source?: string | null }).source ?? null)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Phone</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{phoneLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Event</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">
                    {eventTitle ? <>{eventTitle}{eventStartIso ? <> · <LocalTime iso={eventStartIso} /></> : null}</> : "-"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Package</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">{packageLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Membership</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">{membershipLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Shop</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">{shopLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">MZ series</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">{memberZoneSeriesLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">MZ lesson</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">{memberZoneLessonLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Ref</dt>
                  <dd><span className={ui.code}>{p.reference_code ?? "-"}</span></dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Location</dt>
                  <dd className="text-stone-700 dark:text-stone-300">
                    {p.location_id ? (locationMap.get(p.location_id) ?? "Unknown") : "Unassigned"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Created</dt>
                  <dd className="text-stone-600 dark:text-stone-400">
                    {p.created_at ? <LocalTime iso={p.created_at} /> : "-"}
                  </dd>
                </div>
                {p.verified_at ? (
                  <div className="flex gap-2 sm:col-span-2">
                    <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Verified</dt>
                    <dd className="text-stone-600 dark:text-stone-400">
                      <LocalTime iso={p.verified_at} /> · {p.verified_by ?? "-"}
                    </dd>
                  </div>
                ) : null}
                {(p as { is_gift?: boolean }).is_gift ? (
                  <>
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="w-14 shrink-0 text-teal-500 dark:text-teal-400 sm:w-16">To</dt>
                      <dd className="min-w-0 break-all font-medium text-teal-700 dark:text-teal-300">
                        {(p as { gift_recipient_name?: string | null }).gift_recipient_name
                          ? `${(p as { gift_recipient_name?: string | null }).gift_recipient_name} · `
                          : ""}
                        {(p as { gift_recipient_email?: string | null }).gift_recipient_email ?? "-"}
                      </dd>
                    </div>
                    {(p as { gift_message?: string | null }).gift_message ? (
                      <div className="flex gap-2 sm:col-span-2">
                        <dt className="w-14 shrink-0 text-teal-500 dark:text-teal-400 sm:w-16">Msg</dt>
                        <dd className="min-w-0 wrap-break-word text-stone-600 italic dark:text-stone-400">
                          {(p as { gift_message?: string | null }).gift_message}
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </dl>

              {/* ── Invoice info ──────────────────────────────────── */}
              {p.status === "paid" && p.invoice_status !== "void" ? (
                <div className="mt-3 rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-800/30">
                  {p.invoice_number ? (
                    <p className="text-xs text-stone-600 dark:text-stone-400">
                      Invoice <span className={ui.code}>{p.invoice_number}</span>
                      {p.invoice_sent_at
                        ? <> · sent <LocalTime iso={p.invoice_sent_at} /></>
                        : " · not sent"}
                    </p>
                  ) : (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      Invoice not issued yet — use Send invoice to issue and email it.
                    </p>
                  )}
                </div>
              ) : null}
              {p.status === "refunded" && p.invoice_status === "void" && p.invoice_number ? (
                <div className="mt-3 rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2 dark:border-stone-800 dark:bg-stone-800/30">
                  <p className="text-xs text-stone-600 dark:text-stone-400">
                    Invoice <span className={ui.code}>{p.invoice_number}</span> voided
                    {p.invoice_voided_at ? <> · <LocalTime iso={p.invoice_voided_at} /></> : null}
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
                        <LocalTime iso={a.created_at} /> · {a.action} · {a.actor_role ?? "staff"}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {/* ── Action buttons ────────────────────────────────── */}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
                {p.invoice_status !== "void" && Number(p.amount ?? 0) > 0 ? (
                  <InvoiceSendButton
                    paymentId={p.id}
                    invoiceNumber={p.invoice_number}
                    previewMode={p.status === "paid" || Boolean(p.invoice_number) ? "invoice" : "draft"}
                    allowSend={p.status === "paid"}
                  />
                ) : null}
                {canRefundPayments && p.status === "paid" && Number(p.amount ?? 0) > 0 && p.source !== "membership_subscription" ? (
                  <PaymentMarkButton
                    paymentId={p.id}
                    status="refunded"
                    label="Mark refunded"
                  />
                ) : null}
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
