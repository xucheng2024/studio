import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string }>;
};

export default async function PosOperationsRunbookPage({ searchParams }: Props) {
  const sp = await searchParams;
  const requestedLocationId = sp.location_id && sp.location_id !== "__unassigned" ? sp.location_id : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScopeForRoles({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: requestedLocationId,
  }, ["owner", "manager", "frontdesk"]);

  if (studioIds.length === 0) {
    return <p className={ui.muted}>You do not have access to this guide.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const allowsStudioLevelLocationFilter = hasStudioGlobalLocationAccess(ctx, activeStudioId);
  const locationFilter =
    sp.location_id === "__unassigned" && allowsStudioLevelLocationFilter
      ? "__unassigned"
      : selectedLocationId;

  const posHref = `/dashboard/pos?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`;
  const paymentsHref = `/dashboard/payments?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`;
  const cashSessionsHref = `/dashboard/pos/cash-sessions?studio_id=${activeStudioId}${locationFilter && locationFilter !== "__unassigned" ? `&location_id=${locationFilter}` : ""}`;
  const pendingPosCashHref = `${paymentsHref}&attention=pending_pos_cash`;
  const unassignedCashHref = `${paymentsHref}&unassigned_cash=1&payment_method=cash&source=pos_sale`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className={ui.h1}>Cash session guide</h1>
        <div className="flex flex-wrap gap-2">
          <DashboardAppLink href={posHref} className={ui.btnSecondarySm}>
            Back to POS
          </DashboardAppLink>
          <DashboardAppLink href={cashSessionsHref} className={ui.btnSecondarySm}>
            Cash sessions
          </DashboardAppLink>
          <DashboardAppLink href={paymentsHref} className={ui.btnSecondarySm}>
            Back to payments
          </DashboardAppLink>
        </div>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>When to use this</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>Taking POS cash for a shift: open a session, collect cash, close the session, then check any difference.</li>
          <li>POS or Payments says there is no open cash session, and staff are unsure whether they can take cash.</li>
          <li>A paid or refunded cash sale is missing a cash session.</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Standard flow</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>
            <span className="font-medium">Before collecting cash:</span>
            check the banner on POS or Payments. If no session is open, open one under
            <DashboardAppLink href={cashSessionsHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Cash sessions
            </DashboardAppLink>
            .
          </li>
          <li><span className="font-medium">Open the session:</span> pick the correct location and enter the opening float. Only one open session is allowed per location.</li>
          <li><span className="font-medium">Collect cash:</span> after the sale is waiting for payment, take the cash. The payment is attached to the open session automatically.</li>
          <li><span className="font-medium">If collection fails:</span> if you see “no open cash session for location”, do not retry. Open a session first, then collect.</li>
          <li><span className="font-medium">Close the session:</span> enter counted cash. The system calculates cash in, cash out, expected cash, and over or short.</li>
          <li><span className="font-medium">If cash is over or short:</span> check refunds and manual cash movements, write a note, and have a manager review.</li>
        </ol>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>End-of-shift checklist</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>
            Open
            <DashboardAppLink href={pendingPosCashHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Pending POS cash (7d)
            </DashboardAppLink>
            and confirm there are no leftover unpaid cash sales.
          </li>
          <li>
            Open
            <DashboardAppLink href={unassignedCashHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Unassigned POS cash
            </DashboardAppLink>
            and confirm paid or refunded cash sales are attached to a session.
          </li>
          <li>Confirm refunds from this shift landed on the same session.</li>
          <li>If you voided, refunded, or entered cash by hand, note who did it and why before closing.</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Do not</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>Do not edit cash session IDs or cash totals outside this screen.</li>
          <li>Do not have two people process the same sale at once.</li>
          <li>Retry once. If it still fails, escalate with the sale, payment, and session IDs plus the time it failed.</li>
        </ul>
      </section>
    </div>
  );
}
