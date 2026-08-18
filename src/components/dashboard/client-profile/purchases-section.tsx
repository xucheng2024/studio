import { CheckCircle2, Circle } from "lucide-react";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { LocalDate } from "@/components/ui/LocalDate";
import { LocalTime } from "@/components/ui/LocalTime";
import { getMembershipDisplayStatus, isMembershipEnded } from "@/lib/membership-subscription";
import type { PosSaleListRow } from "@/lib/pos-sales-read";
import { ui } from "@/lib/ui";
import { membershipStatusLabel, paymentStatusColors, profileListRow } from "./shared";

type SubscriptionRow = {
  id: string;
  status: string | null;
  membership_name_snapshot?: string | null;
  membership_price_snapshot?: number | null;
  billing_interval_snapshot?: string | null;
  created_at: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  cancel_requested_at?: string | null;
  canceled_at?: string | null;
};

type PackageRow = {
  id: string;
  credits_left: number;
  expiry_date: string | null;
  package_name_snapshot?: string | null;
  package_credits_snapshot?: number | null;
};

type PaymentRow = {
  id: string;
  package_name_snapshot: string | null;
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
  payment_method: string | null;
  reference_code: string | null;
  created_at: string | null;
};

type BookingRow = {
  id: string;
  status: string | null;
  checked_in_at: string | null;
  credit_consumed_at: string | null;
  class_sessions:
    | { start_time?: string | null; classes?: { title?: string | null } | { title?: string | null }[] | null }
    | { start_time?: string | null; classes?: { title?: string | null } | { title?: string | null }[] | null }[]
    | null;
};

export function ClientPurchasesSection({
  subscriptions,
  packages,
  purchases,
  usage,
  posSales,
  scopeParams,
}: {
  subscriptions: SubscriptionRow[];
  packages: PackageRow[];
  purchases: PaymentRow[];
  usage: BookingRow[];
  posSales: PosSaleListRow[];
  scopeParams: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className={ui.h2}>Membership subscription</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {subscriptions.map((subscription) => {
            const displayStatus = getMembershipDisplayStatus(subscription);
            const tone =
              displayStatus === "active"
                ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                : displayStatus === "retrying"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  : displayStatus === "ending"
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400";
            const intervalLabel = subscription.billing_interval_snapshot === "yearly" ? "Yearly" : "Monthly";
            return (
              <li key={subscription.id} className={profileListRow}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {subscription.membership_name_snapshot?.trim() || "Membership"}
                    </p>
                    <p className={`mt-0.5 text-xs ${ui.muted}`}>
                      SGD {Number(subscription.membership_price_snapshot ?? 0).toFixed(2)} · {intervalLabel}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
                    {membershipStatusLabel(displayStatus)}
                  </span>
                </div>
                <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                  {subscription.created_at ? <span>Started <LocalDate iso={subscription.created_at} /></span> : null}
                  {subscription.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription) ? (
                    <span>Active until <LocalDate iso={subscription.current_period_end} /></span>
                  ) : null}
                  {displayStatus === "canceled" && subscription.canceled_at ? (
                    <span>Ended <LocalDate iso={subscription.canceled_at} /></span>
                  ) : (
                    <span>{subscription.cancel_at_period_end ? "No further renewals scheduled" : "Auto-renews until cancelled"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!subscriptions.length ? (
          <div className={`mt-3 ${ui.emptyState}`}><p className={`text-sm ${ui.muted}`}>No membership subscription.</p></div>
        ) : null}
      </section>

      <section>
        <h2 className={ui.h2}>Current packages</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {packages.map((row) => {
            const packageName = row.package_name_snapshot?.trim() || "Package";
            const packageCredits = Number(row.package_credits_snapshot ?? 0);
            const pct = packageCredits > 0 ? Math.round((row.credits_left / packageCredits) * 100) : null;
            const adjustmentHref = `/dashboard/packages/approvals?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(scopeParams)), client_package_id: row.id }).toString()}`;
            return (
              <li key={row.id} className={`${ui.card} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">{packageName}</p>
                  <p className={`mt-0.5 text-xs ${ui.muted}`}>
                    Expiry: {row.expiry_date ? <LocalDate iso={row.expiry_date} /> : "No expiry"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pct !== null ? (
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                      <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                    {row.credits_left}
                    <span className={`font-normal ${ui.muted}`}> / {packageCredits || "?"}</span>
                  </span>
                  <DashboardAppLink href={adjustmentHref} className={ui.btnSecondarySm}>Adjust via approval</DashboardAppLink>
                </div>
              </li>
            );
          })}
        </ul>
        {!packages.length ? (
          <div className={`mt-3 ${ui.emptyState}`}><p className={`text-sm ${ui.muted}`}>No active packages.</p></div>
        ) : null}
      </section>

      <section>
        <h2 className={ui.h2}>POS sales</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {posSales.map((sale) => (
            <li key={sale.id} className={profileListRow}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {sale.sale_number ?? sale.id.slice(0, 8)} · {sale.currency} {Number(sale.total_amount).toFixed(2)}
                </span>
                <span className={ui.badgeNeutral}>{sale.status.replaceAll("_", " ")}</span>
              </div>
              <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                {sale.location_name ? <span>{sale.location_name}</span> : null}
                <span><LocalTime iso={sale.created_at} /></span>
              </div>
            </li>
          ))}
        </ul>
        {!posSales.length ? (
          <div className={`mt-3 ${ui.emptyState}`}><p className={`text-sm ${ui.muted}`}>No POS sales for this customer.</p></div>
        ) : null}
      </section>

      <section>
        <h2 className={ui.h2}>Package purchases</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {purchases.map((payment) => {
            const statusCls = paymentStatusColors[payment.status ?? ""] ?? paymentStatusColors.pending;
            return (
              <li key={payment.id} className={profileListRow}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    ${(Number(payment.paid_amount ?? payment.amount ?? 0)).toFixed(2)}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls}`}>
                    {payment.status ?? "-"}
                  </span>
                </div>
                <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                  {payment.payment_method ? <span>{payment.payment_method}</span> : null}
                  {payment.reference_code ? <span>Ref: {payment.reference_code}</span> : null}
                  {payment.created_at ? <span><LocalTime iso={payment.created_at} /></span> : null}
                </div>
                {payment.package_name_snapshot?.trim() ? <p className={`mt-1 text-sm ${ui.muted}`}>Package: {payment.package_name_snapshot}</p> : null}
              </li>
            );
          })}
        </ul>
        {!purchases.length ? (
          <div className={`mt-3 ${ui.emptyState}`}><p className={`text-sm ${ui.muted}`}>No purchase records.</p></div>
        ) : null}
      </section>

      <section>
        <h2 className={ui.h2}>Class pass usage</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {usage.map((booking) => {
            const sessionObj = Array.isArray(booking.class_sessions) ? booking.class_sessions[0] : booking.class_sessions;
            const clsObj = Array.isArray(sessionObj?.classes) ? sessionObj?.classes[0] : sessionObj?.classes;
            const checkedIn = Boolean(booking.checked_in_at);
            const creditUsed = Boolean(booking.credit_consumed_at);
            return (
              <li key={booking.id} className={profileListRow}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{clsObj?.title ?? "Class"}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                    booking.status === "booked" || booking.status === "attended"
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                      : booking.status === "cancelled" || booking.status === "no_show"
                        ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}>
                    {(booking.status ?? "scheduled").replaceAll("_", " ")}
                  </span>
                </div>
                <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${ui.muted}`}>
                  {sessionObj?.start_time ? <span><LocalTime iso={String(sessionObj.start_time)} /></span> : null}
                  <span className="flex items-center gap-1">
                    {checkedIn ? <CheckCircle2 size={11} className="text-teal-500" /> : <Circle size={11} className="text-stone-400" />}
                    {checkedIn ? "Checked in" : "Not checked in"}
                  </span>
                  <span className="flex items-center gap-1">
                    {creditUsed ? <CheckCircle2 size={11} className="text-teal-500" /> : <Circle size={11} className="text-stone-400" />}
                    {creditUsed ? "Class pass used" : "Class pass pending"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {!usage.length ? (
          <div className={`mt-3 ${ui.emptyState}`}><p className={`text-sm ${ui.muted}`}>No package-based bookings yet.</p></div>
        ) : null}
      </section>
    </div>
  );
}
