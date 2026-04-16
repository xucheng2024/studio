import { NextResponse } from "next/server";
import { bestRole, buildAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function formatDayRange(inputDate: string | null) {
  if (!inputDate) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }
  const start = new Date(`${inputDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) {
    const now = new Date();
    const s = new Date(now);
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { startIso: s.toISOString(), endIso: e.toISOString() };
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const studioIdInput = url.searchParams.get("studio_id");
  const locationIdInput = url.searchParams.get("location_id");
  const keyword = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const { startIso, endIso } = formatDayRange(url.searchParams.get("date"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await buildAccessContext({ userId: user.id });
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const allStudioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  if (allStudioIds.length === 0) {
    return NextResponse.json({
      pending_verifications: [],
      payment_exceptions: [],
      starting_soon: [],
      unmatched_payments: [],
    });
  }
  const studioIds =
    studioIdInput && allStudioIds.includes(studioIdInput) ? [studioIdInput] : allStudioIds;
  const selectedStudioId = studioIds.length === 1 ? studioIds[0] : null;
  const locationId =
    locationIdInput &&
    ctx.locations.some(
      (l) => l.id === locationIdInput && (selectedStudioId ? l.studio_id === selectedStudioId : true),
    )
      ? locationIdInput
      : null;

  const admin = createAdminClient();
  const payments: Array<{
    id: string;
    studio_id: string;
    location_id: string | null;
    client_id: string | null;
    booking_id: string | null;
    amount: number | null;
    currency: string;
    status: string;
    reference_code: string | null;
    created_at: string | null;
    recon_status: string | null;
    paid_amount: number | null;
    recon_note: string | null;
    customer_confirmed_at: string | null;
  }> = await (async () => {
    let paymentsQuery = admin
      .from("payments")
      .select(
        "id, studio_id, location_id, client_id, booking_id, amount, currency, status, reference_code, created_at, recon_status, paid_amount, recon_note, customer_confirmed_at, verified_at",
      )
      .in("studio_id", studioIds)
      .order("created_at", { ascending: false })
      .limit(300);
    if (locationId) paymentsQuery = paymentsQuery.eq("location_id", locationId);
    const { data } = await paymentsQuery;
    return (data ?? []) as typeof payments;
  })();

  const paymentBookingIds = [...new Set((payments ?? []).map((p) => p.booking_id).filter(Boolean))];
  const { data: paymentBookings } =
    paymentBookingIds.length > 0
      ? await admin
          .from("bookings")
          .select("id, guest_name, guest_email, class_sessions!inner(start_time, classes!inner(title))")
          .in("id", paymentBookingIds)
      : { data: [] as const };
  const bookingMap = new Map((paymentBookings ?? []).map((b) => [b.id, b]));

  const verificationSlaMin = 10;
  const nowMs = Date.now();
  const pendingVerifications = (payments ?? [])
    .filter(
      (p) =>
        p.status === "pending" &&
        (p.recon_status === "awaiting_verification" || p.customer_confirmed_at != null),
    )
    .filter((p) => {
      if (!keyword) return true;
      const b = (p.booking_id ? bookingMap.get(p.booking_id) : null) as
        | { guest_name?: string | null; guest_email?: string | null }
        | undefined;
      return [p.reference_code, b?.guest_name, b?.guest_email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(keyword));
    })
    .map((p) => {
      const booking = (p.booking_id ? bookingMap.get(p.booking_id) : null) as
        | {
            guest_name?: string | null;
            guest_email?: string | null;
            class_sessions?:
              | { start_time?: string | null; classes?: { title?: string | null } | null }
              | Array<{ start_time?: string | null; classes?: { title?: string | null } | null }>
              | null;
          }
        | undefined;
      const session = Array.isArray(booking?.class_sessions)
        ? booking?.class_sessions[0]
        : booking?.class_sessions;
      const cls = Array.isArray(session?.classes) ? session?.classes[0] : session?.classes;
      const submitted = p.customer_confirmed_at ?? p.created_at;
      return {
        id: p.id,
        type: "pending_verification",
        primary_label: `${p.currency} ${Number(p.amount ?? 0).toFixed(2)} · ${p.reference_code ?? "-"}`,
        secondary_label: `${booking?.guest_name ?? booking?.guest_email ?? p.client_id ?? "Member"} · ${
          cls?.title ?? "Payment"
        } · ${submitted ? new Date(submitted).toLocaleString() : "-"}`,
        payment_status: p.status,
        recon_status: p.recon_status,
        exception_code:
          p.customer_confirmed_at &&
          !("verified_at" in p && p.verified_at) &&
          nowMs - new Date(p.customer_confirmed_at).getTime() > verificationSlaMin * 60 * 1000
            ? "verification_sla_overdue"
            : null,
        actions: [
          { kind: "mark_paid", label: "Mark paid", payment_id: p.id },
          { kind: "mark_failed", label: "Mark failed", payment_id: p.id },
          { kind: "more_link", label: "Open detail", href: `/dashboard/payments?payment_id=${p.id}` },
        ],
      };
    });

  const now = new Date();
  const soonEnd = new Date(now.getTime() + 30 * 60 * 1000);
  let soonSessionsQuery = admin
    .from("class_sessions")
    .select("id, location_id, start_time, classes!inner(title, studio_id)")
    .in("classes.studio_id", studioIds)
    .gte("start_time", now.toISOString())
    .lte("start_time", soonEnd.toISOString())
    .order("start_time", { ascending: true })
    .limit(150);
  if (locationId) soonSessionsQuery = soonSessionsQuery.eq("location_id", locationId);
  const { data: soonSessions } = await soonSessionsQuery;
  const soonSessionIds = (soonSessions ?? []).map((s) => s.id);
  const { data: soonBookings } =
    soonSessionIds.length > 0
      ? await admin
          .from("bookings")
          .select("id, session_id, status, client_id, guest_name, guest_email, users(email)")
          .in("session_id", soonSessionIds)
          .eq("status", "booked")
      : { data: [] as const };
  const sessionMap = new Map((soonSessions ?? []).map((s) => [s.id, s]));
  const startingSoon = (soonBookings ?? [])
    .filter((b) => {
      if (!keyword) return true;
      const u = Array.isArray(b.users) ? b.users[0] : b.users;
      return [u?.email, b.guest_email, b.guest_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(keyword));
    })
    .map((b) => {
      const u = Array.isArray(b.users) ? b.users[0] : b.users;
      const s = sessionMap.get(b.session_id) as
        | { start_time?: string | null; classes?: { title?: string | null } | { title?: string | null }[] | null }
        | undefined;
      const cls = Array.isArray(s?.classes) ? s?.classes[0] : s?.classes;
      return {
        id: b.id,
        type: "starting_soon_unchecked_in",
        primary_label: `${cls?.title ?? "Class"} · ${s?.start_time ? new Date(s.start_time).toLocaleTimeString() : "-"}`,
        secondary_label: `${u?.email ?? b.guest_name ?? "Guest"} · ${b.guest_email ?? ""}`,
        booking_status: b.status,
        actions: [
          { kind: "checkin", label: "Check in", booking_id: b.id },
          { kind: "more_link", label: "Open session", href: "/dashboard/schedule" },
        ],
      };
    });

  const paymentExceptions = (payments ?? [])
    .filter((p) => {
      const amountMismatch = Number(p.paid_amount ?? p.amount ?? 0) !== Number(p.amount ?? 0);
      const missingReference = !p.reference_code;
      const verificationSlaOverdue =
        p.customer_confirmed_at &&
        !("verified_at" in p && p.verified_at) &&
        nowMs - new Date(p.customer_confirmed_at).getTime() > verificationSlaMin * 60 * 1000;
      return amountMismatch || missingReference || verificationSlaOverdue || p.recon_status === "mismatch";
    })
    .filter((p) => {
      if (!keyword) return true;
      return [p.reference_code, p.recon_note]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(keyword));
    })
    .map((p) => {
      const expected = Number(p.amount ?? 0);
      const paid = Number(p.paid_amount ?? expected);
      const delta = paid - expected;
      const amountMismatch = paid !== expected;
      const missingReference = !p.reference_code;
      const verificationSlaOverdue =
        p.customer_confirmed_at &&
        !("verified_at" in p && p.verified_at) &&
        nowMs - new Date(p.customer_confirmed_at).getTime() > verificationSlaMin * 60 * 1000;
      return {
        id: p.id,
        type: "payment_exception",
        primary_label: `Expected ${p.currency} ${expected.toFixed(2)} · Paid ${paid.toFixed(2)} · Δ ${delta.toFixed(2)}`,
        secondary_label: `Ref ${p.reference_code ?? "-"} · Recon ${p.recon_status ?? "-"} · ${
          amountMismatch
            ? "amount_mismatch"
            : missingReference
              ? "missing_reference"
              : verificationSlaOverdue
                ? "verification_sla_overdue"
                : "needs_review"
        }`,
        payment_status: p.status,
        recon_status: p.recon_status,
        actions: [
          { kind: "open_match", label: "Match payment", href: "/dashboard/payments?view=pending-review" },
          { kind: "more_link", label: "Open payment", href: `/dashboard/payments?payment_id=${p.id}` },
        ],
      };
    });

  const unmatchedPayments = (payments ?? [])
    .filter((p) => !p.booking_id)
    .filter((p) => {
      if (!keyword) return true;
      return [p.reference_code, p.recon_note]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(keyword));
    })
    .map((p) => ({
      id: p.id,
      type: "unmatched_payment",
      primary_label: `${p.currency} ${Number(p.amount ?? 0).toFixed(2)} · ${p.reference_code ?? "-"}`,
      secondary_label: `No booking attached${p.recon_note ? ` · ${p.recon_note}` : ""}`,
      payment_status: p.status,
      recon_status: p.recon_status,
      exception_code: "unmatched_payment",
      actions: [
        { kind: "open_match", label: "Match payment", href: "/dashboard/payments?view=queue" },
        { kind: "more_link", label: "Open payment", href: `/dashboard/payments?payment_id=${p.id}` },
      ],
    }));

  return NextResponse.json({
    pending_verifications: pendingVerifications,
    payment_exceptions: paymentExceptions,
    starting_soon: startingSoon,
    unmatched_payments: unmatchedPayments,
  });
}
