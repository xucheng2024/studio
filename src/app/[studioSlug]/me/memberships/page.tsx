import { redirect } from "next/navigation";
import { CancelMyMembershipButton } from "@/components/CancelMyMembershipButton";
import { SubscribeMembershipButton } from "@/components/SubscribeMembershipButton";
import { getMembershipDisplayStatus, isMembershipActiveForAccess, isMembershipEnded } from "@/lib/membership-subscription";
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

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyMembershipsPage({ params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);
  if (!studioSlug) redirect("/");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/me/memberships`)}`);

  const { data: activeStudio } = await supabase
    .from("studios")
    .select("id, name, public_slug")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!activeStudio?.id) redirect("/");

  // ── 1. User's subscriptions ──────────────────────────────────────────────
  const { data: subscriptionsRaw } = await supabase
    .from("customer_subscriptions")
    .select("id, status, membership_product_id, membership_name_snapshot, membership_price_snapshot, billing_interval_snapshot, created_at, canceled_at, current_period_end, cancel_at_period_end, cancel_requested_at, billing_start_date, last_charge_at")
    .eq("client_id", user.id)
    .eq("studio_id", activeStudio.id)
    .order("created_at", { ascending: false });
  const subscriptions = subscriptionsRaw ?? [];

  const activeSubs = subscriptions.filter((s) => isMembershipActiveForAccess(s));
  const pastSubs = subscriptions.filter((s) => !isMembershipActiveForAccess(s) && (getMembershipDisplayStatus(s) === "canceled" || isMembershipEnded(s)));

  // IDs with active subscription — don't show "subscribe" for these
  const activeProductIds = new Set(activeSubs.map((s) => String(s.membership_product_id ?? "")));

  // ── 2. Available membership products ────────────────────────────────────
  const { data: allProducts } = await supabase
    .from("membership_products")
    .select("id, name, description, price, currency, billing_interval, share_slug, trial_days, studio_id, studios!inner(name, public_slug)")
    .eq("studio_id", activeStudio.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("price", { ascending: true });

  const availableProducts = (allProducts ?? []).filter((m) => !activeProductIds.has(m.id));

  // ── helpers ──────────────────────────────────────────────────────────────
  function getStudioSlug(m: { studio_id?: string | null; studios?: unknown }) {
    const s = Array.isArray(m.studios) ? m.studios[0] : m.studios;
    return normalizeStudioSlug(String((s as { public_slug?: string | null })?.public_slug ?? ""));
  }
  function getStudioName(m: { studio_id?: string | null; studios?: unknown }) {
    const s = Array.isArray(m.studios) ? m.studios[0] : m.studios;
    return String((s as { name?: string | null })?.name ?? "Studio");
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className={ui.h1}>My memberships</h1>
          <p className={`mt-1 ${ui.muted}`}>Manage your recurring memberships.</p>
        </div>

        {/* ── Active subscriptions ────────────────────────────────────────── */}
        {activeSubs.length > 0 ? (
          <section className="space-y-3">
            <h2 className={ui.h2}>Active</h2>
            <ul className="flex flex-col gap-3">
              {activeSubs.map((subscription) => {
                const billingStartDate = (subscription as { billing_start_date?: string | null }).billing_start_date ?? null;
                const lastCharge = (subscription as { last_charge_at?: string | null }).last_charge_at ?? null;
                const inTrial = Boolean(billingStartDate && !lastCharge && getMembershipDisplayStatus(subscription) !== "canceled");
                const canSelfCancel =
                  getMembershipDisplayStatus(subscription) !== "canceled" &&
                  !isMembershipEnded(subscription) &&
                  (inTrial || !subscription.cancel_at_period_end);
                const trialEndLabel = inTrial && billingStartDate
                  ? new Date(`${billingStartDate}T00:00:00+08:00`).toLocaleDateString("en-SG", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Singapore" })
                  : null;
                const displayStatus = getMembershipDisplayStatus(subscription);
                return (
                  <li key={subscription.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-900 dark:text-stone-100">
                          {subscription.membership_name_snapshot ?? "Membership"}
                        </p>
                        <p className={`mt-0.5 text-sm ${ui.muted}`}>
                          SGD {Number(subscription.membership_price_snapshot ?? 0).toFixed(2)} ·{" "}
                          {subscription.billing_interval_snapshot === "yearly" ? "Yearly" : "Monthly"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                          {subscription.created_at ? (
                            <span>Started {new Date(subscription.created_at).toLocaleDateString("en-SG", { timeZone: "Asia/Singapore" })}</span>
                          ) : null}
                          {inTrial && trialEndLabel ? (
                            <span className="font-medium text-blue-600 dark:text-blue-400">
                              Free trial · first charge on {trialEndLabel}
                            </span>
                          ) : null}
                          {!inTrial && subscription.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription) ? (
                            <span>Active until {new Date(subscription.current_period_end).toLocaleDateString("en-SG", { timeZone: "Asia/Singapore" })}</span>
                          ) : null}
                        </div>
                        <p className={`mt-2 text-sm ${ui.muted}`}>
                          {inTrial
                            ? "You're in your free trial. Cancel any time before the first charge at no cost."
                            : subscription.cancel_at_period_end && subscription.current_period_end && !isMembershipEnded(subscription)
                              ? "Cancellation scheduled — access continues until the end of this period."
                              : "To cancel or change billing, use the button below or contact the studio."}
                        </p>
                        {canSelfCancel ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <CancelMyMembershipButton
                              subscriptionId={subscription.id}
                              label={inTrial ? "Cancel trial" : "Cancel renewal"}
                            />
                            <span className={`text-xs ${ui.muted}`}>
                              {inTrial ? "No charge before the trial ends." : "Stops future renewals; access continues until period end."}
                            </span>
                          </div>
                        ) : null}
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusTone[displayStatus] ?? statusTone.scheduled}`}>
                        {displayStatus}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* ── Available plans ─────────────────────────────────────────────── */}
        {availableProducts.length > 0 ? (
          <section className="space-y-3">
            <h2 className={ui.h2}>{activeSubs.length ? "Other plans" : "Available plans"}</h2>
            <ul className="flex flex-col gap-3">
              {availableProducts.map((m) => {
                const studioSlug = getStudioSlug(m);
                const studioName = getStudioName(m);
                const shareSlug = String((m as { share_slug?: string | null }).share_slug ?? "");
                const trialDays = Number((m as { trial_days?: number | null }).trial_days ?? 0);
                const intervalLabel = (m as { billing_interval?: string | null }).billing_interval === "yearly" ? "Yearly" : "Monthly";
                const ccy = String((m as { currency?: string | null }).currency ?? "SGD").toUpperCase();
                return (
                  <li key={m.id} className={ui.card}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        {!activeStudio?.id ? (
                          <p className={`text-xs font-medium ${ui.muted}`}>{studioName}</p>
                        ) : null}
                        <p className={`font-semibold text-stone-900 dark:text-stone-100 ${!activeStudio?.id ? "mt-0.5" : ""}`}>{m.name}</p>
                        <p className={`mt-1 text-sm ${ui.muted}`}>
                          {ccy} {Number(m.price ?? 0).toFixed(2)} · {intervalLabel}
                        </p>
                        {trialDays > 0 ? (
                          <p className="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300">
                            Free for {trialDays} days
                          </p>
                        ) : null}
                        {(m as { description?: string | null }).description ? (
                          <p className={`mt-2 text-sm ${ui.muted}`}>{String((m as { description?: string | null }).description)}</p>
                        ) : null}
                      </div>
                      {studioSlug && shareSlug ? (
                        <SubscribeMembershipButton
                          membershipId={m.id}
                          studioSlug={studioSlug}
                          label={trialDays > 0 ? `Start free trial` : "Subscribe"}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : activeSubs.length === 0 ? (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>No membership plans available yet.</p>
          </div>
        ) : null}

        {/* ── Past / cancelled ────────────────────────────────────────────── */}
        {pastSubs.length > 0 ? (
          <section className="space-y-3 opacity-60">
            <h2 className={`${ui.h2} text-stone-400 dark:text-stone-500`}>Past memberships</h2>
            <ul className="flex flex-col gap-2">
              {pastSubs.map((subscription) => (
                <li key={subscription.id} className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-stone-600 dark:text-stone-400">
                        {subscription.membership_name_snapshot ?? "Membership"}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                        SGD {Number(subscription.membership_price_snapshot ?? 0).toFixed(2)} ·{" "}
                        {subscription.billing_interval_snapshot === "yearly" ? "Yearly" : "Monthly"}
                        {subscription.canceled_at ? ` · Cancelled ${new Date(subscription.canceled_at).toLocaleDateString("en-SG", { timeZone: "Asia/Singapore" })}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusTone.canceled}`}>
                      cancelled
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
