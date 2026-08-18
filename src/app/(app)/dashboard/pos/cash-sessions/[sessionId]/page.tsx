import { DashboardAppLink } from "@/components/DashboardAppLink";
import { CloseCashSessionForm } from "@/components/dashboard/CloseCashSessionForm";
import { formatLocalDateTime } from "@/lib/date";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ studio_id?: string; location_id?: string }>;
};

type CashSessionRow = {
  id: string;
  studio_id: string;
  location_id: string;
  opened_by: string | null;
  opened_at: string;
  opening_float: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  cash_over_short: number | null;
  status: "open" | "closed" | "voided";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type SessionPaymentRow = {
  id: string;
  pos_sale_id: string | null;
  status: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  reference_code: string | null;
  created_at: string;
  verified_at: string | null;
  paid_at: string | null;
  verified_by: string | null;
};

type PosSaleSummaryRow = {
  id: string;
  sale_number: string | null;
  status: string;
  receipt_number: string | null;
  total_amount: number;
  paid_at: string | null;
};

function money(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

function paymentMethodLabel(method: string | null | undefined) {
  const m = String(method ?? "").toLowerCase();
  if (m === "cash") return "Cash";
  if (m === "hitpay") return "HitPay";
  if (!method) return "-";
  return method;
}

function statusBadgeClass(status: string) {
  if (status === "open") return ui.badgeAmber;
  if (status === "closed") return ui.badge;
  if (status === "voided") return ui.badgeRed;
  return ui.badgeNeutral;
}

export default async function PosCashSessionDetailPage({ params, searchParams }: Props) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const studioId = sp.studio_id?.trim() ?? "";

  if (!studioId) {
    return <p className={ui.muted}>Missing studio scope. Please return to cash sessions list.</p>;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, accessibleLocationIds } = await getDashboardScopeForRoles(
    {
      userId: user.id,
      email: user.email ?? null,
      studioId,
      locationId: sp.location_id ?? null,
    },
    ["owner", "manager", "frontdesk"],
  );

  if (studioIds.length === 0 || !selectedStudioId || selectedStudioId !== studioId) {
    return <p className={ui.muted}>You do not have access to this cash session scope.</p>;
  }

  const admin = createAdminClient();
  const { data: sessionRaw, error: sessionError } = await admin
    .from("pos_cash_sessions")
    .select("id, studio_id, location_id, opened_by, opened_at, opening_float, cash_in, cash_out, expected_cash, closed_by, closed_at, counted_cash, cash_over_short, status, notes, created_at, updated_at")
    .eq("id", sessionId)
    .eq("studio_id", studioId)
    .maybeSingle();

  const backQuery = new URLSearchParams();
  backQuery.set("studio_id", studioId);
  if (sp.location_id?.trim()) backQuery.set("location_id", sp.location_id.trim());

  if (sessionError) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardAppLink href={`/dashboard/pos/cash-sessions?${backQuery.toString()}`} className={ui.btnSecondarySm}>
          Back to cash sessions
        </DashboardAppLink>
        <p className={ui.error}>Could not load cash session: {sessionError.message}</p>
      </div>
    );
  }

  const session = sessionRaw as CashSessionRow | null;
  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardAppLink href={`/dashboard/pos/cash-sessions?${backQuery.toString()}`} className={ui.btnSecondarySm}>
          Back to cash sessions
        </DashboardAppLink>
        <p className={ui.muted}>Cash session not found in current scope.</p>
      </div>
    );
  }

  const canViewAllLocations = hasStudioGlobalLocationAccess(ctx, studioId);
  if (!canViewAllLocations && !accessibleLocationIds.includes(session.location_id)) {
    return (
      <div className="flex flex-col gap-4">
        <DashboardAppLink href={`/dashboard/pos/cash-sessions?${backQuery.toString()}`} className={ui.btnSecondarySm}>
          Back to cash sessions
        </DashboardAppLink>
        <p className={ui.muted}>You do not have access to this location.</p>
      </div>
    );
  }

  const { data: locationRaw } = await admin
    .from("locations")
    .select("id, name")
    .eq("id", session.location_id)
    .maybeSingle<{ id: string; name: string | null }>();

  const { data: paymentsRaw, error: paymentsError } = await admin
    .from("payments")
    .select("id, pos_sale_id, status, amount, currency, payment_method, reference_code, created_at, verified_at, paid_at, verified_by")
    .eq("studio_id", studioId)
    .eq("cash_session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(300);

  if (paymentsError) {
    return <p className={ui.error}>Could not load session payments: {paymentsError.message}</p>;
  }

  const payments = (paymentsRaw ?? []) as SessionPaymentRow[];
  const saleIds = [...new Set(
    payments
      .map((payment) => payment.pos_sale_id)
      .filter((value): value is string => Boolean(value)),
  )];

  const { data: salesRaw } =
    saleIds.length > 0
      ? await admin
          .from("pos_sales")
          .select("id, sale_number, status, receipt_number, total_amount, paid_at")
          .in("id", saleIds)
      : { data: [] as const };
  const salesById = new Map((salesRaw ?? []).map((row) => [row.id, row as PosSaleSummaryRow]));

  const userIds = [...new Set(
    [session.opened_by, session.closed_by, ...payments.map((payment) => payment.verified_by)]
      .filter((value): value is string => Boolean(value)),
  )];
  const { data: usersRaw } =
    userIds.length > 0
      ? await admin
          .from("users")
          .select("id, email")
          .in("id", userIds)
      : { data: [] as const };
  const userEmailById = new Map((usersRaw ?? []).map((row) => [row.id, row.email ?? row.id]));

  const paidCount = payments.filter((payment) => payment.status === "paid").length;
  const refundedCount = payments.filter((payment) => payment.status === "refunded").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardAppLink href={`/dashboard/pos/cash-sessions?${backQuery.toString()}`} className={ui.btnSecondarySm}>
          Back to cash sessions
        </DashboardAppLink>
        <span className={`${statusBadgeClass(session.status)} capitalize`}>{session.status}</span>
      </div>

      <section className={ui.card}>
        <h1 className={ui.h1}>Cash session detail</h1>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className={`text-xs ${ui.muted}`}>Session</dt>
            <dd className="font-medium text-stone-900 dark:text-stone-100">{session.id}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Location</dt>
            <dd>{locationRaw?.name ?? session.location_id}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Opened at</dt>
            <dd>{formatLocalDateTime(session.opened_at)}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Opened by</dt>
            <dd>{session.opened_by ? (userEmailById.get(session.opened_by) ?? session.opened_by) : "-"}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Closed at</dt>
            <dd>{session.closed_at ? formatLocalDateTime(session.closed_at) : "-"}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Closed by</dt>
            <dd>{session.closed_by ? (userEmailById.get(session.closed_by) ?? session.closed_by) : "-"}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Opening float</dt>
            <dd>SGD {money(session.opening_float)}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Cash in</dt>
            <dd>SGD {money(session.cash_in)}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Cash out (refund)</dt>
            <dd>SGD {money(session.cash_out)}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Expected cash</dt>
            <dd>SGD {money(session.expected_cash)}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Counted cash</dt>
            <dd>{session.counted_cash == null ? "-" : `SGD ${money(session.counted_cash)}`}</dd>
          </div>
          <div>
            <dt className={`text-xs ${ui.muted}`}>Over/short</dt>
            <dd>{session.cash_over_short == null ? "-" : `SGD ${money(session.cash_over_short)}`}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className={`text-xs ${ui.muted}`}>Notes</dt>
            <dd>{session.notes?.trim() || "-"}</dd>
          </div>
        </dl>
      </section>

      {session.status === "open" ? (
        <section className={ui.card}>
          <h2 className={ui.h2}>Close cash session</h2>
          <p className={`mt-1 text-sm ${ui.muted}`}>Confirm counted cash. A note is required only when it differs from expected.</p>
          <CloseCashSessionForm
            studioId={studioId}
            sessionId={session.id}
            idempotencyKey={`pos-cash-session-close:${session.id}:${session.updated_at}`}
            expectedCash={Number(session.expected_cash ?? 0)}
          />
        </section>
      ) : null}

      <section className={ui.card}>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <p className={ui.muted}>Payments in session</p>
            <p className="text-xl font-semibold text-stone-900 dark:text-stone-100">{payments.length}</p>
          </div>
          <div>
            <p className={ui.muted}>Paid</p>
            <p className="text-xl font-semibold text-teal-700 dark:text-teal-300">{paidCount}</p>
          </div>
          <div>
            <p className={ui.muted}>Refunded</p>
            <p className="text-xl font-semibold text-amber-700 dark:text-amber-300">{refundedCount}</p>
          </div>
        </div>
      </section>

      <section className={`${ui.card} overflow-x-auto`}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left dark:border-stone-700">
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2">Sale</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Verified by</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={7} className={`px-3 py-6 text-center ${ui.muted}`}>No payments linked to this cash session.</td>
              </tr>
            ) : (
              payments.map((payment) => {
                const sale = payment.pos_sale_id ? salesById.get(payment.pos_sale_id) : null;
                const saleQuery = new URLSearchParams();
                saleQuery.set("studio_id", studioId);
                saleQuery.set("location_id", session.location_id);

                return (
                  <tr key={payment.id} className="border-b border-stone-100 align-top last:border-0 dark:border-stone-800">
                    <td className="px-3 py-2 font-mono text-xs">{payment.reference_code ?? payment.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      {sale ? (
                        <DashboardAppLink
                          href={`/dashboard/pos/${sale.id}?${saleQuery.toString()}`}
                          className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                        >
                          {sale.sale_number ?? sale.id.slice(0, 8)}
                        </DashboardAppLink>
                      ) : (
                        <span className={ui.muted}>-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 capitalize">{payment.status.replaceAll("_", " ")}</td>
                    <td className="px-3 py-2">{paymentMethodLabel(payment.payment_method)}</td>
                    <td className="px-3 py-2">{payment.currency} {money(payment.amount)}</td>
                    <td className="px-3 py-2">{formatLocalDateTime(payment.created_at)}</td>
                    <td className="px-3 py-2">
                      {payment.verified_by ? (userEmailById.get(payment.verified_by) ?? payment.verified_by) : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
