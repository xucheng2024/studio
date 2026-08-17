import Link from "next/link";
import { retryMarketingCampaignAction } from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ campaignId: string }> };

export default async function MarketingCampaignReportPage({ params }: Props) {
  const { campaignId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: campaign } = await admin.from("marketing_campaigns")
    .select("id, studio_id, location_id, name, audience_type, status, scheduled_at, started_at, completed_at, last_error")
    .eq("id", campaignId).maybeSingle();
  if (!campaign) return <p className={ui.muted}>Campaign not found.</p>;
  const scope = await getDashboardScopeForRoles({ userId: user.id, email: user.email, studioId: campaign.studio_id, locationId: campaign.location_id }, ["owner", "manager"]);
  const allowed = scope.ctx.memberships.some((membership) => membership.studio_id === campaign.studio_id && (membership.role === "owner" || membership.role === "manager") && (membership.location_id == null || membership.location_id === campaign.location_id));
  if (!allowed) return <p className={ui.muted}>You do not have access to this campaign.</p>;
  const { data: recipients } = await admin.from("marketing_campaign_recipients")
    .select("id, eligibility, dispatch_status, attempt_count, submitted_at, delivered_at, first_clicked_at, last_error")
    .eq("campaign_id", campaignId);
  const rows = recipients ?? [];
  const count = (predicate: (row: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;
  const attempted = count((row) => row.attempt_count > 0);
  const delivered = count((row) => Boolean(row.delivered_at));
  const clicked = count((row) => Boolean(row.first_clicked_at));
  const metrics: Array<[string, number]> = [
    ["Snapshot", rows.length], ["Excluded", count((row) => row.attempt_count === 0 && row.eligibility !== "eligible")], ["Attempted", attempted],
    ["Submitted", count((row) => Boolean(row.submitted_at))], ["Delivered", delivered], ["Failed", count((row) => row.dispatch_status === "failed")],
    ["Bounced", count((row) => row.dispatch_status === "bounced")], ["Complained", count((row) => row.dispatch_status === "complained")],
    ["Unique clicked", clicked], ["Unsubscribed", count((row) => row.eligibility === "unsubscribed")],
  ];
  const deliveryRate = attempted ? `${((delivered / attempted) * 100).toFixed(1)}%` : "-";
  const clickRate = delivered ? `${((clicked / delivered) * 100).toFixed(1)}%` : "-";
  const failedRows = rows.filter((row) => row.dispatch_status === "failed");
  const retryableRows = failedRows.filter((row) => row.last_error !== "dispatch outcome could not be reconciled");
  return <div className="space-y-6">
    <div><Link className="text-sm underline" href={`/dashboard/marketing?studio_id=${campaign.studio_id}${campaign.location_id ? `&location_id=${campaign.location_id}` : ""}`}>← Marketing</Link><h1 className={ui.h1}>{campaign.name}</h1><p className={ui.muted}>{campaign.audience_type} · <span className="capitalize">{campaign.status}</span></p></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className={ui.muted}>{label}</div><div className="text-2xl font-semibold">{value}</div></div>)}</div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className={ui.muted}>Delivery success</div><div className="text-2xl font-semibold">{deliveryRate}</div></div><div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className={ui.muted}>Unique click rate</div><div className="text-2xl font-semibold">{clickRate}</div></div></div>
    {campaign.last_error ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{campaign.last_error}</p> : null}
    {retryableRows.length ? <ServerActionToastForm action={retryMarketingCampaignAction} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><input type="hidden" name="studio_id" value={campaign.studio_id} /><input type="hidden" name="location_id" value={campaign.location_id ?? ""} /><input type="hidden" name="campaign_id" value={campaign.id} /><p className="mb-3 text-sm">{retryableRows.length} recipient(s) can be reviewed and retried. Bounce, complaint, suppression, withdrawn consent, and unreconciled provider outcomes are never retried automatically.</p><SubmitButton className={ui.btnPrimary}>Retry failed recipients</SubmitButton></ServerActionToastForm> : null}
    {failedRows.length ? <section><h2 className="mb-3 text-lg font-semibold">Failure details</h2><div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800"><table className="min-w-full text-sm"><thead><tr className="text-left text-stone-500"><th className="p-3">Recipient ID</th><th className="p-3">Attempts</th><th className="p-3">Last error</th></tr></thead><tbody>{failedRows.map((row) => <tr key={row.id} className="border-t border-stone-200 dark:border-stone-800"><td className="p-3 font-mono text-xs">{row.id}</td><td className="p-3">{row.attempt_count}</td><td className="p-3">{row.last_error ?? "-"}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}
