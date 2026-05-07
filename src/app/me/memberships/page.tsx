import Link from "next/link";
import { redirect } from "next/navigation";
import { CancelMyMembershipButton } from "@/components/CancelMyMembershipButton";
import { getMembershipDisplayStatus, isMembershipEnded } from "@/lib/membership-subscription";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

const statusTone: Record<string, string> = {
  active: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/50",
  ending: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50",
  scheduled: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50",
  retrying: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50",
  inactive: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
  paused: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
  canceled: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
};

export default async function MyMembershipsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: subscriptions } = await supabase
    .from("customer_subscriptions")
    .select("id, status, membership_name_snapshot, membership_price_snapshot, billing_interval_snapshot, created_at, canceled_at, current_period_end, cancel_at_period_end, cancel_requested_at, billing_start_date, last_charge_at")
    .eq("client_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className={ui.h1}>My memberships</h1>
          <p className={`mt-1 ${ui.muted}`}>Your recurring memberships and current status.</p>
        </div>

        <ul className="flex flex-col gap-2">
          {(subscriptions ?? []).map((subscription) => (
            <li key={subscription.id} className={ui.card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">
                    {subscription.membership_name_snapshot ?? "Membership"}
                  </p>
                  <p className={`mt-1 text-sm ${ui.muted}`}>
                    SGD {Number(subscription.membership_price_snapshot ?? 0).toFixed(2)} ·{" "}
                    {subscription.billing_interval_snapshot === "yearly" ? "Yearly" : "Monthly"}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusTone[getMembershipDisplayStatus(subscription) ?? ""] ?? statusTone.scheduled}`}>
                  {getMembershipDisplayStatus(subscription)}
                </span>
              </div>
              {(() => {
                const billingStartDate = (subscription as { billing_start_date?: string | null }).billing_start_date ?? null;
                const lastCharge = (subscription as { last_charge_at?: string | null }).last_charge_at ?? null;
                const inTrial = billingStartDate && !lastCharge && getMembershipDisplayStatus(subscription) !== "canceled";
                const trialEndLabel = inTrial
                  ? new Date(`${billingStartDate}T00:00:00+08:00`).toLocaleDateString("en-SG", { year: "numeric", month: "short", day: "numeric" })
                  : null;
                return (
                  <>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                      {subscription.created_at ? (
                        <span>Started {new Date(subscription.created_at).toLocaleDateString("en-SG")}</span>
                      ) : null}
                      {inTrial && trialEndLabel ? (
                        <span className="font-medium text-blue-600 dark:text-blue-400">Free trial · first charge on {trialEndLabel}</span>
                      ) : null}
                      {!inTrial && subscription.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription) ? (
                        <span>Active until {new Date(subscription.current_period_end).toLocaleDateString("en-SG")}</span>
                      ) : null}
                      {subscription.canceled_at ? (
                        <span>Cancelled {new Date(subscription.canceled_at).toLocaleDateString("en-SG")}</span>
                      ) : null}
                    </div>
                    <p className={`mt-2 text-sm ${ui.muted}`}>
                      {inTrial
                        ? "You're in your free trial. Cancel any time before the first charge at no cost."
                        : subscription.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription)
                          ? "Cancellation is scheduled for the end of the current billing period."
                          : "Need to cancel or change billing details? Contact the studio directly."}
                    </p>
                    {inTrial ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <CancelMyMembershipButton subscriptionId={subscription.id} />
                        <span className={`text-xs ${ui.muted}`}>Cancels before the first charge.</span>
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </li>
          ))}
        </ul>

        {!subscriptions?.length ? (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>No memberships yet.</p>
            <Link href="/booking" className={`mt-1 text-sm ${ui.link}`}>
              Browse studios →
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
