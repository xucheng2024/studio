import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { PaymentMarkButton } from "@/components/PaymentMarkButton";
import { PaymentCopyButton } from "@/components/PaymentCopyButton";
import { InvoiceSendButton } from "@/components/InvoiceSendButton";
import { SyncHitpayPaymentButton } from "@/components/SyncHitpayPaymentButton";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { completePosCashSaleAction } from "@/app/(app)/dashboard/actions";
import { dayRangeEndExclusiveIso, dayRangeStartIso, localISODate } from "@/lib/date";
import { LocalTime } from "@/components/ui/LocalTime";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { hasStudioGlobalLocationAccess, hasStudioRole } from "@/lib/rbac";
import {
  PAYMENT_METHOD_FILTER_OPTIONS,
  PAYMENT_SALES_CHANNEL_FILTER_OPTIONS,
  PAYMENT_SOURCE_FILTER_OPTIONS,
} from "@/lib/payment-filter-options";
import { paymentOrderType, paymentOrderTypeLabel, paymentSalesChannelLabel } from "@/lib/payment-classification";
import { HITPAY_WEBHOOK_FAILURE_CODES } from "@/lib/hitpay-webhook-observability";
import { POS_OPERATION_FAILURE_CODES } from "@/lib/pos-operation-observability";
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
    sales_channel?: string;
    cash_session_id?: string;
    unassigned_cash?: string;
    date_from?: string;
    date_to?: string;
    q?: string;
    payment_id?: string;
    attention?: string;
  }>;
};

function isoDateDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return localISODate(d);
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function primaryItemLabel(input: {
  source: string | null;
  bookingId?: string | null;
  eventBookingId?: string | null;
  sessionTitle: string | null;
  eventTitle: string | null;
  packageLabel: string;
  membershipLabel: string;
  shopLabel: string;
  serviceLabel: string;
  memberZoneSeriesLabel: string;
  memberZoneLessonLabel: string;
}) {
  switch (paymentOrderType({
    source: input.source,
    bookingId: input.bookingId,
    eventBookingId: input.eventBookingId,
  })) {
    case "session":
      return input.sessionTitle || "-";
    case "event":
      return input.eventTitle || "-";
    case "package":
      return input.packageLabel;
    case "membership":
      return input.membershipLabel;
    case "member_zone":
      return input.memberZoneLessonLabel !== "-" ? input.memberZoneLessonLabel : input.memberZoneSeriesLabel;
    case "shop":
      return input.shopLabel;
    case "service":
      return input.serviceLabel;
    default:
      return "-";
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

function paymentOpsHint(input: {
  status: string | null | undefined;
  paymentMethod: string | null | undefined;
  source: string | null | undefined;
  verifiedAt: string | null | undefined;
}) {
  const status = String(input.status ?? "").toLowerCase();
  const method = String(input.paymentMethod ?? "").toLowerCase();
  const source = String(input.source ?? "").toLowerCase();
  if (status !== "pending" || input.verifiedAt) return null;

  if (method === "hitpay") {
    if (source === "membership_subscription") {
      return {
        tone: "amber" as const,
        text: "Waiting for HitPay recurring confirmation. If the member says they already paid, use Sync HitPay on the membership record.",
      };
    }
    return {
      tone: "amber" as const,
      text: "Waiting for HitPay confirmation. If the customer says they already paid, use Sync HitPay here before marking anything manually.",
    };
  }

  if (method === "free") {
    return {
      tone: "neutral" as const,
      text: "Free checkout is still being finalized.",
    };
  }

  return {
    tone: "neutral" as const,
    text: "Pending payment. Confirm only after you have verified the funds.",
  };
}

export default async function DashboardPaymentsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const requestedLocationId =
    sp.location_id && sp.location_id !== "__unassigned" ? sp.location_id : null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: requestedLocationId,
  }, ["owner", "manager", "frontdesk"]);
  if (studioIds.length === 0) return <p className={ui.muted}>You do not have access to this page.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const activeStudioId = selectedStudioId ?? studioIds[0];
  const allowsStudioLevelLocationFilter = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const locationFilter =
    sp.location_id === "__unassigned" && allowsStudioLevelLocationFilter
      ? "__unassigned"
      : selectedLocationId;
  const canRefundPayments = hasStudioRole(ctx, activeStudioId, ["owner", "manager"]);
  const canSyncHitpayPayments = hasStudioRole(ctx, activeStudioId, ["owner", "manager", "frontdesk"]);
  const isPendingHitpayAttention = sp.attention === "pending_hitpay";
  const isPendingPosCashAttention = sp.attention === "pending_pos_cash";
  const cashSessionIdFilter = (sp.cash_session_id ?? "").trim();
  const isUnassignedCashFilter = sp.unassigned_cash === "1";
  const { data: activeStudio } = await admin
    .from("studios")
    .select("id, public_slug")
    .eq("id", activeStudioId)
    .maybeSingle();
  const activeStudioSlug = activeStudio?.public_slug?.trim() ?? null;
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", [activeStudioId])
    .eq("is_active", true)
    .order("name");
  const locationMap = new Map((locations ?? []).map((l) => [l.id, l.name ?? "Unnamed location"]));

  const locationNameForStatus =
    locationFilter && locationFilter !== "__unassigned"
      ? (locationMap.get(locationFilter) ?? "Current location")
      : null;
  const cashSessionScopeHref = `/dashboard/pos/cash-sessions?studio_id=${activeStudioId}${locationFilter && locationFilter !== "__unassigned" ? `&location_id=${locationFilter}` : ""}`;
  const { data: openCashSession } =
    locationFilter && locationFilter !== "__unassigned"
      ? await admin
          .from("pos_cash_sessions")
          .select("id, opened_at, opening_float, status")
          .eq("studio_id", activeStudioId)
          .eq("location_id", locationFilter)
          .eq("status", "open")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null as { id: string; opened_at: string; opening_float: number; status: string } | null };

  let q = admin
    .from("payments")
    .select(
      "id, studio_id, location_id, pos_sale_id, client_id, booking_id, event_booking_id, package_id, membership_product_id, customer_subscription_id, member_zone_series_id, member_zone_lesson_id, shop_product_id, service_id, guest_name, guest_email, guest_phone, is_gift, gift_recipient_name, gift_recipient_email, gift_message, status, payment_method, source, sales_channel, cash_session_id, amount, currency, reference_code, gateway_payment_id, created_at, expires_at, verified_at, verified_by, invoice_number, invoice_sent_at, invoice_status, invoice_voided_at, invoice_void_reason, package_name_snapshot, membership_name_snapshot, shop_product_name_snapshot, service_title_snapshot",
    )
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false })
    .limit(300);
  if (locationFilter === "__unassigned") q = q.is("location_id", null);
  else if (locationFilter) q = q.eq("location_id", locationFilter);
  if (isPendingHitpayAttention) {
    q = q.eq("status", "pending").eq("payment_method", "hitpay");
  } else if (isPendingPosCashAttention) {
    q = q.eq("status", "pending").eq("payment_method", "cash").eq("source", "pos_sale");
  } else if (cashSessionIdFilter) {
    q = q.eq("payment_method", "cash").eq("source", "pos_sale").eq("cash_session_id", cashSessionIdFilter);
  } else if (isUnassignedCashFilter) {
    q = q.eq("payment_method", "cash").eq("source", "pos_sale").is("cash_session_id", null);
  } else if (sp.payment_method) {
    q = q.eq("payment_method", sp.payment_method);
  }
  if (sp.payment_id) q = q.eq("id", sp.payment_id);
  if (sp.source) q = q.eq("source", sp.source);
  if (sp.sales_channel) q = q.eq("sales_channel", sp.sales_channel);
  const defaultDate = localISODate();
  const attentionDateFrom = isoDateDaysAgo(6);
  const dateFrom = sp.date_from ?? ((isPendingHitpayAttention || isPendingPosCashAttention) ? attentionDateFrom : defaultDate);
  const dateTo = sp.date_to ?? defaultDate;
  if (!sp.payment_id) {
    const from = dayRangeStartIso(dateFrom);
    if (from) q = q.gte("created_at", from);
    const to = dayRangeEndExclusiveIso(dateTo);
    if (to) q = q.lt("created_at", to);
  }

  const pendingHitpayStart = dayRangeStartIso(attentionDateFrom) ?? "";
  const pendingHitpayEnd = dayRangeEndExclusiveIso(defaultDate) ?? "";
  const { count: pendingHitpayCount } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", activeStudioId)
    .eq("status", "pending")
    .eq("payment_method", "hitpay")
    .gte("created_at", pendingHitpayStart)
    .lt("created_at", pendingHitpayEnd);

  const { count: pendingPosCashCount } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", activeStudioId)
    .eq("status", "pending")
    .eq("payment_method", "cash")
    .eq("source", "pos_sale")
    .gte("created_at", pendingHitpayStart)
    .lt("created_at", pendingHitpayEnd);

  let unassignedPosCashQuery = admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", activeStudioId)
    .eq("payment_method", "cash")
    .eq("source", "pos_sale")
    .in("status", ["paid", "refunded"])
    .is("cash_session_id", null)
    .gte("created_at", pendingHitpayStart)
    .lt("created_at", pendingHitpayEnd);
  if (locationFilter === "__unassigned") unassignedPosCashQuery = unassignedPosCashQuery.is("location_id", null);
  else if (locationFilter) unassignedPosCashQuery = unassignedPosCashQuery.eq("location_id", locationFilter);
  const { count: unassignedPosCashCount } = await unassignedPosCashQuery;

  // This is an operations window, not a calendar-day filter: keep it to the
  // preceding 24 hours regardless of when the page is opened.
  const webhookWindowStart = isoHoursAgo(24);
  let webhookFailuresQuery = admin
    .from("hitpay_webhook_failures")
    .select("id, location_id, payment_id, error_code, error_detail, event_type, provider_event_id, provider_payment_id, occurred_at")
    .eq("provider", "hitpay")
    .eq("studio_id", activeStudioId)
    .gte("occurred_at", webhookWindowStart)
    .order("occurred_at", { ascending: false })
    .limit(40);
  if (locationFilter === "__unassigned") webhookFailuresQuery = webhookFailuresQuery.is("location_id", null);
  else if (locationFilter) webhookFailuresQuery = webhookFailuresQuery.eq("location_id", locationFilter);

  const { data: webhookFailuresRaw } = await webhookFailuresQuery;
  type WebhookFailureRow = {
    id: string;
    location_id: string | null;
    payment_id: string | null;
    error_code: string;
    error_detail: string | null;
    event_type: string | null;
    provider_event_id: string | null;
    provider_payment_id: string | null;
    occurred_at: string;
  };
  const webhookFailures = (webhookFailuresRaw ?? []) as WebhookFailureRow[];
  const webhookFailureCounts = new Map<string, number>();
  for (const code of HITPAY_WEBHOOK_FAILURE_CODES) {
    let countQuery = admin
      .from("hitpay_webhook_failures")
      .select("id", { count: "exact", head: true })
      .eq("provider", "hitpay")
      .eq("studio_id", activeStudioId)
      .eq("error_code", code)
      .gte("occurred_at", webhookWindowStart);
    if (locationFilter === "__unassigned") countQuery = countQuery.is("location_id", null);
    else if (locationFilter) countQuery = countQuery.eq("location_id", locationFilter);
    const { count } = await countQuery;
    webhookFailureCounts.set(code, count ?? 0);
  }

  let posFailuresQuery = admin
    .from("pos_operation_failures")
    .select("id, location_id, sale_id, payment_id, operation, error_code, error_detail, occurred_at")
    .eq("studio_id", activeStudioId)
    .gte("occurred_at", webhookWindowStart)
    .order("occurred_at", { ascending: false })
    .limit(40);
  if (locationFilter === "__unassigned") posFailuresQuery = posFailuresQuery.is("location_id", null);
  else if (locationFilter) posFailuresQuery = posFailuresQuery.eq("location_id", locationFilter);

  const { data: posFailuresRaw } = await posFailuresQuery;
  type PosFailureRow = {
    id: string;
    location_id: string | null;
    sale_id: string | null;
    payment_id: string | null;
    operation: string;
    error_code: string;
    error_detail: string | null;
    occurred_at: string;
  };
  const posFailures = (posFailuresRaw ?? []) as PosFailureRow[];
  const posFailureCounts = new Map<string, number>(POS_OPERATION_FAILURE_CODES.map((code) => [code, 0]));
  for (const row of posFailures) {
    if (!posFailureCounts.has(row.error_code)) continue;
    posFailureCounts.set(row.error_code, (posFailureCounts.get(row.error_code) ?? 0) + 1);
  }

  const recentExceptions = [
    ...webhookFailures.map((row) => ({
      id: `webhook:${row.id}`,
      source: "webhook" as const,
      code: row.error_code,
      detail: row.error_detail,
      eventType: row.event_type,
      paymentId: row.payment_id,
      saleId: null as string | null,
      providerEventId: row.provider_event_id,
      providerPaymentId: row.provider_payment_id,
      operation: null as string | null,
      occurredAt: row.occurred_at,
    })),
    ...posFailures.map((row) => ({
      id: `pos:${row.id}`,
      source: "pos" as const,
      code: row.error_code,
      detail: row.error_detail,
      eventType: null as string | null,
      paymentId: row.payment_id,
      saleId: row.sale_id,
      providerEventId: null as string | null,
      providerPaymentId: null as string | null,
      operation: row.operation,
      occurredAt: row.occurred_at,
    })),
  ]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 10);

  const { data: rawPayments } = await q;
  const payments = rawPayments ?? [];
  const bookingIds = [...new Set(payments.map((p) => p.booking_id).filter(Boolean))];
  const eventBookingIds = [...new Set(payments.map((p) => (p as { event_booking_id?: string | null }).event_booking_id).filter(Boolean))];
  const clientIds = [...new Set(payments.map((p) => p.client_id).filter(Boolean))];
  const packageIds = [...new Set(payments.map((p) => (p as { package_id?: string | null }).package_id).filter(Boolean))];
  const memberZoneSeriesIds = [...new Set(payments.map((p) => (p as { member_zone_series_id?: string | null }).member_zone_series_id).filter(Boolean))];
  const memberZoneLessonIds = [...new Set(payments.map((p) => (p as { member_zone_lesson_id?: string | null }).member_zone_lesson_id).filter(Boolean))];
  const serviceIds = [...new Set(payments.map((p) => (p as { service_id?: string | null }).service_id).filter(Boolean))];

  const [{ data: bookings }, { data: eventBookings }, { data: packageRows }, { data: memberZoneSeriesRows }, { data: memberZoneLessonRows }, { data: serviceRows }, { data: clients }, { data: clientProfiles }] = await Promise.all([
    bookingIds.length > 0
      ? admin
          .from("bookings")
          .select("id, guest_name, guest_email, guest_phone, class_sessions(start_time, classes(title))")
          .in("id", bookingIds)
      : Promise.resolve({ data: [] as const }),
    eventBookingIds.length > 0
      ? admin
          .from("event_bookings")
          .select("id, guest_name, guest_email, guest_phone, events(title, start_time)")
          .in("id", eventBookingIds)
      : Promise.resolve({ data: [] as const }),
    packageIds.length > 0
      ? admin
          .from("packages")
          .select("id, name")
          .in("id", packageIds)
      : Promise.resolve({ data: [] as const }),
    memberZoneSeriesIds.length > 0
      ? admin
          .from("member_zone_series")
          .select("id, title")
          .in("id", memberZoneSeriesIds)
      : Promise.resolve({ data: [] as const }),
    memberZoneLessonIds.length > 0
      ? admin
          .from("member_zone_lessons")
          .select("id, title")
          .in("id", memberZoneLessonIds)
      : Promise.resolve({ data: [] as const }),
    serviceIds.length > 0
      ? admin
          .from("studio_services")
          .select("id, title")
          .in("id", serviceIds)
      : Promise.resolve({ data: [] as const }),
    clientIds.length > 0
      ? admin.from("users").select("id, email").in("id", clientIds)
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
  const serviceMap = new Map((serviceRows ?? []).map((row) => [row.id, row]));
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
    const service = (p as { service_id?: string | null }).service_id
      ? serviceMap.get((p as { service_id?: string | null }).service_id ?? "")
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
      p.id,
      (p as { pos_sale_id?: string | null }).pos_sale_id ?? null,
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
      (p as { service_title_snapshot?: string | null }).service_title_snapshot ?? service?.title ?? null,
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
  if (locationFilter) exportParams.set("location_id", locationFilter);
  if (sp.payment_method) exportParams.set("payment_method", sp.payment_method);
  if (sp.source) exportParams.set("source", sp.source);
  if (sp.sales_channel) exportParams.set("sales_channel", sp.sales_channel);
  if (cashSessionIdFilter) exportParams.set("cash_session_id", cashSessionIdFilter);
  if (isUnassignedCashFilter) exportParams.set("unassigned_cash", "1");
  exportParams.set("date_from", dateFrom);
  exportParams.set("date_to", dateTo);
  if (sp.q) exportParams.set("q", sp.q);
  if (sp.attention) exportParams.set("attention", sp.attention);

  const baseScopeParams = new URLSearchParams();
  baseScopeParams.set("studio_id", activeStudioId);
  if (locationFilter) baseScopeParams.set("location_id", locationFilter);

  const pendingHitpayParams = new URLSearchParams(baseScopeParams);
  pendingHitpayParams.set("attention", "pending_hitpay");
  pendingHitpayParams.set("date_from", attentionDateFrom);
  pendingHitpayParams.set("date_to", defaultDate);

  const pendingPosCashParams = new URLSearchParams(baseScopeParams);
  pendingPosCashParams.set("attention", "pending_pos_cash");
  pendingPosCashParams.set("date_from", attentionDateFrom);
  pendingPosCashParams.set("date_to", defaultDate);

  const unassignedCashParams = new URLSearchParams(baseScopeParams);
  unassignedCashParams.set("unassigned_cash", "1");
  unassignedCashParams.set("payment_method", "cash");
  unassignedCashParams.set("source", "pos_sale");
  unassignedCashParams.set("date_from", attentionDateFrom);
  unassignedCashParams.set("date_to", defaultDate);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div>
        <h1 className={ui.h1}>Payments</h1>
        <p className={`mt-1 ${ui.muted}`}>Check incoming payments, export records, and view action history.</p>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          Use Sync HitPay before manual changes when a customer says they paid. HitPay refunds are attempted automatically; other refund methods are recorded after you process them outside this app.
        </p>

        <div className="mt-3">
          {locationFilter === "__unassigned" ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-200">
              Cash session status is unavailable for unassigned payments scope.
            </div>
          ) : !locationFilter ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-200">
              Select a location to show current open cash-session status before collecting POS cash.
              <DashboardAppLink href={cashSessionScopeHref} className="ml-1 underline">Open cash sessions</DashboardAppLink>
            </div>
          ) : openCashSession ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <p className="font-medium">{locationNameForStatus} has an open cash session.</p>
              <p className="mt-1 text-xs sm:text-sm">
                Session {openCashSession.id} opened {openCashSession.opened_at ? <LocalTime iso={openCashSession.opened_at} /> : "-"} · opening float SGD {Number(openCashSession.opening_float ?? 0).toFixed(2)}.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
              <p className="font-medium">{locationNameForStatus} has no open cash session.</p>
              <p className="mt-1 text-xs sm:text-sm">
                Open a cash session first to avoid cash-collection errors on POS sales.
                <DashboardAppLink href={cashSessionScopeHref} className="ml-1 underline">Open now</DashboardAppLink>
              </p>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2">
          <DashboardAppLink
            href={`/dashboard/payments?${pendingHitpayParams.toString()}`}
            className={isPendingHitpayAttention ? ui.btnPrimarySm : ui.btnSecondarySm}
          >
            Pending HitPay (7d)
            {typeof pendingHitpayCount === "number" ? ` · ${pendingHitpayCount}` : ""}
          </DashboardAppLink>
          <DashboardAppLink
            href={`/dashboard/payments?${pendingPosCashParams.toString()}`}
            className={isPendingPosCashAttention ? ui.btnPrimarySm : ui.btnSecondarySm}
          >
            Pending POS Cash (7d)
            {typeof pendingPosCashCount === "number" ? ` · ${pendingPosCashCount}` : ""}
          </DashboardAppLink>
          <DashboardAppLink
            href={`/dashboard/payments?${unassignedCashParams.toString()}`}
            className={isUnassignedCashFilter ? ui.btnPrimarySm : ui.btnSecondarySm}
          >
            Unassigned POS Cash (7d)
            {typeof unassignedPosCashCount === "number" ? ` · ${unassignedPosCashCount}` : ""}
          </DashboardAppLink>
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
        {locationFilter ? <input type="hidden" name="location_id" value={locationFilter} /> : null}
        {isPendingHitpayAttention ? <input type="hidden" name="attention" value="pending_hitpay" /> : null}
        {isPendingPosCashAttention ? <input type="hidden" name="attention" value="pending_pos_cash" /> : null}

        <div className="flex flex-wrap gap-3">
          <DashboardLocationFilter
            locations={locations ?? []}
            selectedStudioId={activeStudioId}
            selectedLocationId={locationFilter}
            allowAll={allowsStudioLevelLocationFilter}
            accessibleLocationIds={accessibleLocationIds}
            unassignedLabel={allowsStudioLevelLocationFilter ? "Studio-level / Unassigned" : undefined}
          />
        </div>

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
            <select
              name="payment_method"
              className={ui.select}
              defaultValue={isPendingHitpayAttention ? "hitpay" : (isPendingPosCashAttention ? "cash" : (sp.payment_method ?? ""))}
            >
              <option value="">All</option>
              {PAYMENT_METHOD_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Order type</span>
            <select name="source" className={ui.select} defaultValue={isPendingPosCashAttention ? "pos_sale" : (sp.source ?? "")}>
              <option value="">All</option>
              {PAYMENT_SOURCE_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Channel</span>
            <select name="sales_channel" className={ui.select} defaultValue={sp.sales_channel ?? ""}>
              <option value="">All</option>
              {PAYMENT_SALES_CHANNEL_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Cash session ID</span>
            <input
              name="cash_session_id"
              defaultValue={cashSessionIdFilter}
              className={ui.input}
              placeholder="session uuid"
            />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-200">
            <input
              type="checkbox"
              name="unassigned_cash"
              value="1"
              defaultChecked={isUnassignedCashFilter}
              className="size-4"
            />
            Show POS cash with empty cash session
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Search customer / item / ref</span>
          <input name="q" defaultValue={sp.q ?? ""} className={ui.input} placeholder="customer name, item title, email, ref…" />
        </label>

        {/* ── Apply / Reset ─────────────────────────────────── */}
        <div className={`${ui.mobileActionBar} flex flex-col gap-2 sm:flex-row`}>
          <SubmitButton className={ui.btnPrimarySm} pendingText="Applying...">
            Apply filters
          </SubmitButton>
          <DashboardAppLink
            href={`/dashboard/payments?${baseScopeParams.toString()}`}
            className={ui.btnGhost}
          >
            Clear filters
          </DashboardAppLink>
        </div>
      </form>

      {isPendingHitpayAttention ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          Showing pending one-time HitPay payments from the last 7 days so older exceptions do not disappear behind the default today filter.
        </div>
      ) : null}
      {isPendingPosCashAttention ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-300">
          Showing pending POS cash payments from the last 7 days for faster frontdesk collection follow-up.
        </div>
      ) : null}
      {(isUnassignedCashFilter || cashSessionIdFilter || (typeof unassignedPosCashCount === "number" && unassignedPosCashCount > 0)) ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          <p className="font-medium">POS cash session tracking</p>
          <p className="mt-1 text-xs sm:text-sm">
            Paid/refunded POS cash without cash session (last 7 days): {typeof unassignedPosCashCount === "number" ? unassignedPosCashCount : "-"}.
            <DashboardAppLink href={`/dashboard/payments?${unassignedCashParams.toString()}`} className="ml-1 underline">
              Open unassigned cash
            </DashboardAppLink>
            {cashSessionIdFilter ? ` · Viewing cash session: ${cashSessionIdFilter}` : ""}
          </p>
        </div>
      ) : null}

      <section className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={ui.h2}>Payment issues (last 24 hours)</h2>
            <p className={ui.muted}>Failed HitPay updates, voids, and refunds.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DashboardAppLink
              href={`/dashboard/payments/runbook?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`}
              className={ui.btnSecondarySm}
            >
              Pending payment guide
            </DashboardAppLink>
            <DashboardAppLink
              href={`/dashboard/pos/runbook?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`}
              className={ui.btnSecondarySm}
            >
              Cash session guide
            </DashboardAppLink>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
            <p className={`text-xs ${ui.muted}`}>Invalid payment signature</p>
            <p className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{webhookFailureCounts.get("invalid_signature") ?? 0}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
            <p className={`text-xs ${ui.muted}`}>Payment event not recorded</p>
            <p className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{webhookFailureCounts.get("provider_event_claim_failed") ?? 0}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
            <p className={`text-xs ${ui.muted}`}>Sale could not be marked paid</p>
            <p className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{webhookFailureCounts.get("complete_pos_hitpay_sale_failed") ?? 0}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
            <p className={`text-xs ${ui.muted}`}>Void failed</p>
            <p className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{posFailureCounts.get("void_pos_sale_failed") ?? 0}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
            <p className={`text-xs ${ui.muted}`}>Refund failed</p>
            <p className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{posFailureCounts.get("refund_pos_sale_failed") ?? 0}</p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
            <p className={`text-xs ${ui.muted}`}>Item refund failed</p>
            <p className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{posFailureCounts.get("refund_pos_sale_items_failed") ?? 0}</p>
          </div>
        </div>
        {recentExceptions.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {recentExceptions.map((failure) => (
              <li key={failure.id} className="rounded-lg border border-stone-100 bg-white px-3 py-2 text-xs dark:border-stone-800 dark:bg-stone-900/40">
                <span className="font-medium text-stone-900 dark:text-stone-100">{failure.code}</span>
                <span className={`ml-1 ${ui.muted}`}>[{failure.source === "webhook" ? "webhook" : "pos"}]</span>
                {failure.operation ? ` · ${failure.operation}` : ""}
                {failure.eventType ? ` · ${failure.eventType}` : ""}
                {failure.saleId ? ` · sale ${failure.saleId}` : ""}
                {failure.paymentId ? ` · payment ${failure.paymentId}` : ""}
                {failure.providerEventId ? ` · event ${failure.providerEventId}` : ""}
                {failure.providerPaymentId ? ` · provider payment ${failure.providerPaymentId}` : ""}
                {failure.detail ? ` · ${failure.detail}` : ""}
                <span className={`ml-1 ${ui.muted}`}>
                  (<LocalTime iso={failure.occurredAt} />)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-3 text-sm ${ui.muted}`}>No payment issues in the last 24 hours.</p>
        )}
      </section>

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
          const service = (p as { service_id?: string | null }).service_id
            ? serviceMap.get((p as { service_id?: string | null }).service_id ?? "")
            : null;
          const serviceLabel =
            (p as { service_title_snapshot?: string | null }).service_title_snapshot?.trim() ||
            service?.title?.trim() ||
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
          const cashSessionId = (p as { cash_session_id?: string | null }).cash_session_id ?? null;
          const isPosCash = (p.payment_method ?? "").toLowerCase() === "cash" && source === "pos_sale";
          const isUnassignedPosCash = isPosCash && !cashSessionId && (p.status === "paid" || p.status === "refunded");
          const orderTypeLabel = paymentOrderTypeLabel({
            source,
            bookingId: p.booking_id,
            eventBookingId: (p as { event_booking_id?: string | null }).event_booking_id,
          });
          const salesChannelLabel = paymentSalesChannelLabel({
            salesChannel: (p as { sales_channel?: string | null }).sales_channel ?? null,
            source,
          });
          const itemLabel = primaryItemLabel({
            source,
            bookingId: p.booking_id,
            eventBookingId: (p as { event_booking_id?: string | null }).event_booking_id,
            sessionTitle,
            eventTitle,
            packageLabel,
            membershipLabel,
            shopLabel,
            serviceLabel,
            memberZoneSeriesLabel,
            memberZoneLessonLabel,
          });
          const opsHint = paymentOpsHint({
            status: p.status,
            paymentMethod: p.payment_method,
            source,
            verifiedAt: p.verified_at,
          });
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
                    <span className={ui.badgeNeutral}>{salesChannelLabel}</span>
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
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Type</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{orderTypeLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Name</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">{nameLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Item</dt>
                  <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">
                    {itemLabel}
                    {paymentOrderType({
                      source,
                      bookingId: p.booking_id,
                      eventBookingId: (p as { event_booking_id?: string | null }).event_booking_id,
                    }) === "session" && sessionStartIso ? <> · <LocalTime iso={sessionStartIso} /></> : null}
                    {paymentOrderType({
                      source,
                      bookingId: p.booking_id,
                      eventBookingId: (p as { event_booking_id?: string | null }).event_booking_id,
                    }) === "event" && eventStartIso ? <> · <LocalTime iso={eventStartIso} /></> : null}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Phone</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{phoneLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Channel</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{salesChannelLabel}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Method</dt>
                  <dd className="text-stone-700 dark:text-stone-300">{paymentMethodLabel(p.payment_method)}</dd>
                </div>
                {isPosCash ? (
                  <div className="flex gap-2 sm:col-span-2">
                    <dt className="w-14 shrink-0 text-stone-400 dark:text-stone-500 sm:w-16">Session</dt>
                    <dd className="min-w-0 break-all text-stone-700 dark:text-stone-300">
                      {cashSessionId ? (
                        <DashboardAppLink
                          href={`/dashboard/pos/cash-sessions/${cashSessionId}?studio_id=${activeStudioId}${p.location_id ? `&location_id=${p.location_id}` : ""}`}
                          className={ui.linkMuted}
                        >
                          {cashSessionId}
                        </DashboardAppLink>
                      ) : (
                        <span className={isUnassignedPosCash ? "font-medium text-rose-700 dark:text-rose-300" : ""}>
                          Unassigned
                        </span>
                      )}
                    </dd>
                  </div>
                ) : null}
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
              {opsHint ? (
                <div
                  className={`mt-3 rounded-xl px-3 py-2 text-xs ${
                    opsHint.tone === "amber"
                      ? "border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
                      : "border border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-800/30 dark:text-stone-300"
                  }`}
                >
                  {opsHint.text}
                </div>
              ) : null}
              {isUnassignedPosCash ? (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
                  Cash payment is paid/refunded but has no `cash_session_id`. Investigate and reconcile this sale before day close.
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
                {p.status === "pending" && source === "pos_sale" && (p as { pos_sale_id?: string | null }).pos_sale_id ? (
                  <ServerActionToastForm action={completePosCashSaleAction} refreshOnSuccess>
                    <input type="hidden" name="studio_id" value={activeStudioId} />
                    <input type="hidden" name="sale_id" value={(p as { pos_sale_id?: string | null }).pos_sale_id ?? ""} />
                    <input type="hidden" name="idempotency_key" value={`pos-cash-complete-payment:${p.id}:${p.created_at}`} />
                    <button type="submit" className={ui.btnPrimarySm}>
                      Mark as paid (cash)
                    </button>
                  </ServerActionToastForm>
                ) : null}
                {canSyncHitpayPayments &&
                activeStudioSlug &&
                p.status === "pending" &&
                (p.payment_method ?? "").toLowerCase() === "hitpay" &&
                Boolean((p as { gateway_payment_id?: string | null }).gateway_payment_id) &&
                p.source !== "membership_subscription" ? (
                  <SyncHitpayPaymentButton paymentId={p.id} studioSlug={activeStudioSlug} />
                ) : null}
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
                    label={(p.payment_method ?? "").toLowerCase() === "hitpay" ? "Refund" : "Record refund"}
                    paymentMethod={p.payment_method}
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
