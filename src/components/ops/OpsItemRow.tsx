"use client";

import { DashboardAppLink } from "@/components/DashboardAppLink";
import { CheckInApiButton } from "@/components/CheckInApiButton";
import { PaymentMarkButton } from "@/components/PaymentMarkButton";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { ui } from "@/lib/ui";

type Action =
  | { kind: "mark_paid" | "mark_failed" | "mark_expired"; label: string; payment_id: string }
  | { kind: "checkin"; label: string; booking_id: string }
  | { kind: "approve" | "reject" | "open_match" | "more_link"; label: string; href: string };

function actionLabel(action: Action) {
  switch (action.kind) {
    case "mark_paid":
      return "Confirm payment";
    case "mark_failed":
      return "Mark as failed";
    case "mark_expired":
      return "Mark as expired";
    case "checkin":
      return "Check in";
    case "open_match":
      return "Link payment to booking";
    case "more_link":
      return "View details";
    default:
      return action.label;
  }
}

export function OpsItemRow({
  primary,
  secondary,
  bookingStatus,
  paymentStatus,
  reconStatus,
  actions,
  sectionKey,
  onActionDone,
}: {
  primary: string;
  secondary: string;
  bookingStatus?: string | null;
  paymentStatus?: string | null;
  reconStatus?: string | null;
  actions: Action[];
  sectionKey: "pending_verifications" | "starting_soon" | "payment_exceptions" | "unmatched_payments";
  onActionDone?: (section: "pending_verifications" | "starting_soon" | "payment_exceptions" | "unmatched_payments") => void;
}) {
  const badges = getUnifiedStatusBadges({
    booking_status: bookingStatus,
    payment_status: paymentStatus,
    recon_status: reconStatus,
  });
  const primaryActions = actions.slice(0, 2);
  const moreActions = actions.slice(2);

  return (
    <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
      <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{primary}</p>
      <p className={`mt-1 text-xs ${ui.muted}`}>{secondary}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {bookingStatus ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${badgeToneClass(badges.booking.tone)}`}>
            {badges.booking.text}
          </span>
        ) : null}
        {paymentStatus ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${badgeToneClass(badges.payment.tone)}`}>
            {badges.payment.text}
          </span>
        ) : null}
        {reconStatus ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${badgeToneClass(badges.recon.tone)}`}>
            {badges.recon.text}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {primaryActions.map((a, i) => {
          if (a.kind === "mark_paid") {
            return (
              <PaymentMarkButton
                key={`a-${i}`}
                paymentId={a.payment_id}
                status="paid"
                label={actionLabel(a)}
                onDone={() => onActionDone?.(sectionKey)}
              />
            );
          }
          if (a.kind === "mark_failed") {
            return (
              <PaymentMarkButton
                key={`a-${i}`}
                paymentId={a.payment_id}
                status="failed"
                label={actionLabel(a)}
                onDone={() => onActionDone?.(sectionKey)}
              />
            );
          }
          if (a.kind === "mark_expired") {
            return (
              <PaymentMarkButton
                key={`a-${i}`}
                paymentId={a.payment_id}
                status="expired"
                label={actionLabel(a)}
                onDone={() => onActionDone?.(sectionKey)}
              />
            );
          }
          if (a.kind === "checkin") {
            return <CheckInApiButton key={`a-${i}`} bookingId={a.booking_id} onDone={() => onActionDone?.(sectionKey)} />;
          }
          if ("href" in a) {
            return (
              <DashboardAppLink key={`a-${i}`} href={a.href} className={ui.btnSecondarySm}>
                {actionLabel(a)}
              </DashboardAppLink>
            );
          }
          return null;
        })}
        {moreActions.length ? (
          <details className="relative">
            <summary className={ui.btnGhost}>More actions</summary>
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-stone-200 bg-white p-1 dark:border-stone-700 dark:bg-stone-900">
              {moreActions.map((a, i) =>
                "href" in a ? (
                  <DashboardAppLink
                    key={`m-${i}`}
                    href={a.href}
                    className="block rounded px-2 py-1.5 text-sm text-stone-700 transition-colors hover:bg-stone-100 active:opacity-80 dark:text-stone-200 dark:hover:bg-stone-800"
                  >
                    {actionLabel(a)}
                  </DashboardAppLink>
                ) : null,
              )}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
