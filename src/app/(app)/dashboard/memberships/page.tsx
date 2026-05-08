import { createMembershipProduct } from "@/app/(app)/dashboard/actions";
import { CancelMembershipSubscriptionButton } from "@/components/CancelMembershipSubscriptionButton";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { MembershipLifecycleRow } from "@/components/dashboard/MembershipLifecycleRow";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { getMembershipDisplayStatus, isMembershipEnded } from "@/lib/membership-subscription";
import { bestRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ location_id?: string; studio_id?: string }> };

export default async function MembershipsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0) return <p className={ui.muted}>Create your first studio in Overview.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  const canEdit = ["owner", "manager"].includes(role);
  const canCopyLink = ["owner", "manager", "frontdesk"].includes(role);
  const activeStudioId = selectedStudioId ?? studioIds[0];

  let membershipQuery = supabase
    .from("membership_products")
    .select("id, name, description, price, billing_interval, trial_days, studio_id, location_id, is_active, share_slug, deleted_at, studios(public_slug)")
    .eq("studio_id", activeStudioId)
    .is("deleted_at", null)
    .order("price");
  if (selectedLocationId) membershipQuery = membershipQuery.eq("location_id", selectedLocationId);
  const { data: memberships } = await membershipQuery;

  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", [activeStudioId])
    .eq("is_active", true)
    .order("name");

  const admin = createAdminClient();
  let subscriptionsQuery = admin
    .from("customer_subscriptions")
    .select("id, client_id, status, membership_name_snapshot, membership_price_snapshot, billing_interval_snapshot, created_at, customer_email_snapshot, customer_name_snapshot, membership_product_id, current_period_end, cancel_at_period_end, cancel_requested_at, membership_products!inner(studio_id, location_id)")
    .eq("membership_products.studio_id", activeStudioId)
    .in("status", ["scheduled", "active", "retrying", "inactive", "paused"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (selectedLocationId) {
    subscriptionsQuery = subscriptionsQuery.eq("membership_products.location_id", selectedLocationId);
  }
  const { data: subscriptions } = await subscriptionsQuery;

  const backParams = new URLSearchParams();
  if (selectedStudioId) backParams.set("studio_id", selectedStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);
  const backHref = `/dashboard/packages${backParams.toString() ? `?${backParams.toString()}` : ""}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Memberships</h1>
        <p className={`mt-2 ${ui.lead}`}>Create recurring monthly or yearly memberships and manage live subscribers.</p>
        <div className="mt-3">
          <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>
            Back to packages
          </DashboardAppLink>
        </div>
        {canEdit ? (
          <details className={`chevron ${ui.card} mt-5 w-full max-w-xl`} id="create-membership">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
              <span>+ New membership</span>
              <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Expand to create</span>
            </summary>
            <form action={createMembershipProduct} className="mt-4 grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="studio_id" value={activeStudioId} />
              <input type="hidden" name="location_id" value={selectedLocationId ?? ""} />
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Name</span>
                <input name="name" required className={ui.input} placeholder="Monthly Membership" />
              </label>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Description</span>
                <textarea name="description" rows={3} className={ui.input} placeholder="What this membership covers." />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Price</span>
                <input name="price" type="number" min={0} step="0.01" defaultValue={120} className={ui.input} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Billing interval</span>
                <select name="billing_interval" defaultValue="monthly" className={ui.select}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={ui.label}>Trial</span>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                    <input name="trial_enabled" type="checkbox" className="accent-teal-600" />
                    Enable trial / refund guarantee
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                    <span className={ui.muted}>Days</span>
                    <input
                      name="trial_days"
                      type="number"
                      min={1}
                      max={60}
                      step="1"
                      defaultValue={14}
                      className={`${ui.input} w-24`}
                    />
                  </label>
                </div>
                <p className={`text-xs ${ui.muted}`}>
                  If enabled, the public page will show a “X-day trial / guarantee” message. (Rules enforcement is configured separately.)
                </p>
              </div>
              <SubmitButton className={`${ui.btnPrimary} w-full sm:col-span-2 sm:w-fit`} pendingText="Saving...">
                Save membership
              </SubmitButton>
            </form>
          </details>
        ) : null}
      </div>

      {!(memberships ?? []).length ? (
        <div className={ui.emptyState}>
          <p className={`text-sm ${ui.muted}`}>No memberships yet.</p>
          {canEdit ? <p className={`mt-1 text-xs ${ui.muted}`}>Expand “+ New membership” above to create your first recurring plan.</p> : null}
        </div>
      ) : null}

      <section>
        <h2 className={ui.h2}>Membership products</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {(memberships ?? []).map((membership) => {
            const st = membership.studios as { public_slug?: string | null } | { public_slug?: string | null }[] | null;
            const pub = Array.isArray(st) ? st[0]?.public_slug : st?.public_slug;
            return (
              <li key={membership.id} className={ui.card}>
                <MembershipLifecycleRow
                  membershipId={membership.id}
                  studioPublicSlug={pub ?? null}
                  shareSlug={membership.share_slug ?? null}
                  canEdit={canEdit}
                  canCopyLink={canCopyLink}
                  locations={(locationRows ?? []).map((l) => ({ id: l.id, name: l.name }))}
                  initial={{
                    name: membership.name,
                    description: (membership as { description?: string | null }).description ?? null,
                    price: Number(membership.price ?? 0),
                    billing_interval: ((membership as { billing_interval?: string | null }).billing_interval === "yearly" ? "yearly" : "monthly"),
                    location_id: membership.location_id ?? null,
                    trial_days: Number((membership as { trial_days?: number | null }).trial_days ?? 0),
                  }}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className={ui.h2}>Active subscribers</h2>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          This list is for membership operations. Use Users when you want the full customer profile.
        </p>
        {(subscriptions ?? []).length ? (
          <div className={`${ui.card} mt-3 overflow-hidden p-0`}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                    <th className="px-4 py-3 font-medium">Subscriber</th>
                    <th className="px-4 py-3 font-medium">Membership</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
          {(subscriptions ?? []).filter((subscription) => !isMembershipEnded(subscription)).map((subscription) => {
                    const tone =
                      getMembershipDisplayStatus(subscription) === "active"
                        ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                        : getMembershipDisplayStatus(subscription) === "retrying"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : getMembershipDisplayStatus(subscription) === "ending"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400";
                    return (
                      <tr key={subscription.id} className="border-b border-stone-100 last:border-b-0 dark:border-stone-800">
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium text-stone-900 dark:text-stone-100">
                            {subscription.customer_name_snapshot?.trim() || subscription.customer_email_snapshot || "Subscriber"}
                          </p>
                          <p className={`mt-0.5 text-xs ${ui.muted}`}>
                            {subscription.customer_email_snapshot || "No email"}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium text-stone-900 dark:text-stone-100">
                            {subscription.membership_name_snapshot || "Membership"}
                          </p>
                          <p className={`mt-0.5 text-xs ${ui.muted}`}>
                            SGD {Number(subscription.membership_price_snapshot ?? 0).toFixed(2)} ·{" "}
                            {subscription.billing_interval_snapshot === "yearly" ? "Yearly" : "Monthly"}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone}`}>
                            {getMembershipDisplayStatus(subscription)}
                          </span>
                          {subscription.cancel_at_period_end && subscription.current_period_end ? (
                            <p className={`mt-1 text-xs ${ui.muted}`}>
                              Ends {new Date(subscription.current_period_end).toLocaleDateString("en-SG")}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="text-stone-800 dark:text-stone-200">
                            {subscription.created_at
                              ? new Date(subscription.created_at).toLocaleDateString("en-SG")
                              : "-"}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <CancelMembershipSubscriptionButton subscriptionId={subscription.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className={`${ui.emptyState} mt-3`}>
            <p className={`text-sm ${ui.muted}`}>No active subscribers yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}
