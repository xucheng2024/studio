import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { hasStudioGlobalLocationAccess } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ studio_id?: string; location_id?: string }>;
};

export default async function HitpayPendingRunbookPage({ searchParams }: Props) {
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

  const paymentsHref = `/dashboard/payments?studio_id=${activeStudioId}${locationFilter ? `&location_id=${locationFilter}` : ""}`;
  const pendingHitpayHref = `${paymentsHref}&attention=pending_hitpay`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className={ui.h1}>Pending payment guide</h1>
        <DashboardAppLink href={paymentsHref} className={ui.btnSecondarySm}>
          Back to payments
        </DashboardAppLink>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>When to use this</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>The customer shows a paid screenshot, but the payment is still pending.</li>
          <li>The POS sale is waiting for payment and the method is HitPay.</li>
          <li>You think the payment update from HitPay was delayed or missed.</li>
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>What to do</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>
            Open
            <DashboardAppLink href={pendingHitpayHref} className="ml-1 text-teal-700 underline-offset-2 hover:underline dark:text-teal-300">
              Pending HitPay (7d)
            </DashboardAppLink>
            and confirm the payment is still pending.
          </li>
          <li>Match the amount, customer name, payment time, and reference code (or POS sale ID).</li>
          <li>
            On Payments or the POS sale, click <span className={ui.code}>Sync HitPay</span>.
          </li>
          <li>Wait for the page to refresh. Continue only after the payment is paid, refunded, or failed.</li>
          <li>If it is still pending, wait 2 minutes and sync once more. Do not click repeatedly.</li>
          <li>If it is still wrong after two syncs, check Payment issues (last 24 hours) on Payments.</li>
          <li>
            If you see invalid signature, payment event not recorded, or sale could not be marked paid, escalate with the payment ID, event ID, and time.
          </li>
        </ol>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Do not</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>Do not mark the payment as paid by hand, or create a second payment, until you have confirmed the money landed.</li>
          <li>Do not let two people sync the same order at the same time.</li>
          <li>Do not skip escalation when the issue board shows a failure. That can miss or double-count money.</li>
        </ul>
      </section>
    </div>
  );
}
