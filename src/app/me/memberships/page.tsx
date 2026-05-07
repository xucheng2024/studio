import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CancelMyMembershipButton } from "@/components/CancelMyMembershipButton";
import { SubscribeMembershipButton } from "@/components/SubscribeMembershipButton";
import { ACTIVE_MEMBER_STUDIO_COOKIE } from "@/lib/member-studio-shared";
import { getMembershipDisplayStatus, isMembershipEnded } from "@/lib/membership-subscription";
import { normalizeStudioSlug } from "@/lib/slug";
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

  const c = await cookies();
  const activeStudioSlug = normalizeStudioSlug(c.get(ACTIVE_MEMBER_STUDIO_COOKIE)?.value ?? "");
  const { data: activeStudio } = activeStudioSlug
    ? await supabase
        .from("studios")
        .select("id, name, public_slug")
        .eq("public_slug", activeStudioSlug)
        .maybeSingle()
    : { data: null };

  const { data: availableMemberships } = activeStudio?.id
    ? await supabase
        .from("membership_products")
        .select("id, name, description, price, currency, billing_interval, share_slug, trial_days")
        .eq("studio_id", activeStudio.id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("price", { ascending: true })
    : { data: null };

  const { data: memberStudios } = !activeStudio?.id
    ? await supabase
        .from("member_studio_memberships")
        .select("studios!inner(id, name, public_slug)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(50)
    : { data: null };

  const studioIds = (memberStudios ?? [])
    .map((row) => {
      const s = (row as { studios?: { id?: string | null } | { id?: string | null }[] | null }).studios;
      const st = Array.isArray(s) ? s[0] : s;
      return st?.id ?? null;
    })
    .filter((v): v is string => Boolean(v));

  const { data: fallbackMemberships } =
    !activeStudio?.id && studioIds.length
      ? await supabase
          .from("membership_products")
          .select("id, name, description, price, currency, billing_interval, share_slug, trial_days, studio_id")
          .in("studio_id", studioIds)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("price", { ascending: true })
      : { data: null };

  const studioById = new Map<string, { name: string; public_slug: string }>();
  for (const row of memberStudios ?? []) {
    const s = (row as { studios?: { id?: string | null; name?: string | null; public_slug?: string | null } | any[] | null }).studios;
    const st = Array.isArray(s) ? s[0] : s;
    const id = String(st?.id ?? "");
    const slug = String(st?.public_slug ?? "");
    if (id && slug) studioById.set(id, { name: String(st?.name ?? "Studio"), public_slug: slug });
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className={ui.h1}>My memberships</h1>
          <p className={`mt-1 ${ui.muted}`}>Your recurring memberships and current status.</p>
        </div>

        {(subscriptions ?? []).length ? (
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
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusTone[getMembershipDisplayStatus(subscription) ?? ""] ?? statusTone.scheduled}`}
                  >
                    {getMembershipDisplayStatus(subscription)}
                  </span>
                </div>
                {(() => {
                  const billingStartDate = (subscription as { billing_start_date?: string | null }).billing_start_date ?? null;
                  const lastCharge = (subscription as { last_charge_at?: string | null }).last_charge_at ?? null;
                  const inTrial = billingStartDate && !lastCharge && getMembershipDisplayStatus(subscription) !== "canceled";
                  const canSelfCancel =
                    getMembershipDisplayStatus(subscription) !== "canceled" &&
                    !isMembershipEnded(subscription) &&
                    (inTrial || !subscription.cancel_at_period_end);
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
                      {canSelfCancel ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <CancelMyMembershipButton
                            subscriptionId={subscription.id}
                            label={inTrial ? "Cancel trial" : "Cancel renewal"}
                          />
                          <span className={`text-xs ${ui.muted}`}>
                            {inTrial ? "Cancels before the first charge." : "Stops future renewals (access continues until period end)."}
                          </span>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </li>
            ))}
          </ul>
        ) : availableMemberships?.length ? (
          <div className="space-y-4">
            <p className={`text-sm ${ui.muted}`}>
              You don’t have a membership yet{activeStudio?.name ? ` for ${activeStudio.name}` : ""}. Choose a plan below to start.
            </p>
            <ul className="flex flex-col gap-3">
              {availableMemberships.map((m) => {
                const studioSlug = activeStudio?.public_slug ?? activeStudioSlug;
                const shareSlug = String((m as { share_slug?: string | null }).share_slug ?? "");
                const trialDays = Number((m as { trial_days?: number | null }).trial_days ?? 0);
                const intervalLabel = (m as { billing_interval?: string | null }).billing_interval === "yearly" ? "Yearly" : "Monthly";
                const ccy = String((m as { currency?: string | null }).currency ?? "SGD").toUpperCase();
                return (
                  <li key={m.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-900 dark:text-stone-100">{m.name}</p>
                        <p className={`mt-1 text-sm ${ui.muted}`}>
                          {ccy} {Number(m.price ?? 0).toFixed(2)} · {intervalLabel}
                          {trialDays > 0 ? ` · Free for ${trialDays} days` : ""}
                        </p>
                        {(m as { description?: string | null }).description ? (
                          <p className={`mt-2 text-sm ${ui.muted}`}>{String((m as { description?: string | null }).description)}</p>
                        ) : null}
                      </div>
                      {studioSlug && shareSlug ? (
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <SubscribeMembershipButton
                            membershipId={m.id}
                            studioSlug={studioSlug}
                            label="Subscribe"
                          />
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : fallbackMemberships?.length ? (
          <div className="space-y-4">
            <p className={`text-sm ${ui.muted}`}>You don’t have a membership yet. Choose a plan below to start.</p>
            <ul className="flex flex-col gap-3">
              {fallbackMemberships.map((m) => {
                const studioId = String((m as { studio_id?: string | null }).studio_id ?? "");
                const studio = studioById.get(studioId) ?? null;
                const studioSlug = studio?.public_slug ?? "";
                const shareSlug = String((m as { share_slug?: string | null }).share_slug ?? "");
                const trialDays = Number((m as { trial_days?: number | null }).trial_days ?? 0);
                const intervalLabel = (m as { billing_interval?: string | null }).billing_interval === "yearly" ? "Yearly" : "Monthly";
                const ccy = String((m as { currency?: string | null }).currency ?? "SGD").toUpperCase();
                return (
                  <li key={m.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400">
                          {studio?.name ?? "Studio"}
                        </p>
                        <p className="mt-1 font-semibold text-stone-900 dark:text-stone-100">{m.name}</p>
                        <p className={`mt-1 text-sm ${ui.muted}`}>
                          {ccy} {Number(m.price ?? 0).toFixed(2)} · {intervalLabel}
                          {trialDays > 0 ? ` · Free for ${trialDays} days` : ""}
                        </p>
                        {(m as { description?: string | null }).description ? (
                          <p className={`mt-2 text-sm ${ui.muted}`}>{String((m as { description?: string | null }).description)}</p>
                        ) : null}
                      </div>
                      {studioSlug && shareSlug ? (
                        <SubscribeMembershipButton
                          membershipId={m.id}
                          studioSlug={studioSlug}
                          label="Subscribe"
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>Memberships are not available yet.</p>
          </div>
        )}
      </div>
    </main>
  );
}
