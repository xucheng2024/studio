import Link from "next/link";
import { redirect } from "next/navigation";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

const statusTone: Record<string, string> = {
  active: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/50",
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
    .select("id, status, membership_name_snapshot, membership_price_snapshot, billing_interval_snapshot, created_at, canceled_at")
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
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusTone[subscription.status ?? ""] ?? statusTone.scheduled}`}>
                  {subscription.status ?? "unknown"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                {subscription.created_at ? (
                  <span>Started {new Date(subscription.created_at).toLocaleDateString("en-SG")}</span>
                ) : null}
                {subscription.canceled_at ? (
                  <span>Cancelled {new Date(subscription.canceled_at).toLocaleDateString("en-SG")}</span>
                ) : null}
              </div>
              <p className={`mt-2 text-sm ${ui.muted}`}>
                Need to cancel or change billing details? Contact the studio directly.
              </p>
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
