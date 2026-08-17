import Link from "next/link";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { createMarketingCampaignAction, scheduleMarketingCampaignAction, sendMarketingTestEmailAction } from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

export default async function MarketingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId, accessibleLocationIds } = await getDashboardScopeForRoles({ userId: user.id, email: user.email, studioId: sp.studio_id ?? null, locationId: sp.location_id ?? null }, ["owner", "manager"]);
  if (!studioIds.length) return <p className={ui.muted}>You do not have access to marketing.</p>;
  const studioId = selectedStudioId ?? studioIds[0];
  const studioLocationIds = ctx.locations.filter((location) => location.studio_id === studioId && accessibleLocationIds.includes(location.id)).map((location) => location.id);
  const hasStudioWideAccess = ctx.memberships.some((membership) => membership.studio_id === studioId && (membership.role === "owner" || membership.role === "manager") && membership.location_id == null);
  const effectiveLocationId = selectedLocationId && studioLocationIds.includes(selectedLocationId) ? selectedLocationId : hasStudioWideAccess ? null : studioLocationIds[0] ?? null;
  if (!hasStudioWideAccess && !effectiveLocationId) return <p className={ui.muted}>You do not have access to an active marketing location.</p>;
  const admin = createAdminClient();
  let campaignsQuery = admin.from("marketing_campaigns").select("id, name, audience_type, status, recipient_snapshot_at, scheduled_at, created_at").eq("studio_id", studioId);
  if (effectiveLocationId) campaignsQuery = campaignsQuery.eq("location_id", effectiveLocationId);
  const [{ data: studio }, { data: locations }, { data: campaigns }] = await Promise.all([
    admin.from("studios").select("id, name").eq("id", studioId).maybeSingle(),
    admin.from("locations").select("id, name, studio_id").eq("studio_id", studioId).eq("is_active", true).order("name"),
    campaignsQuery.order("created_at", { ascending: false }).limit(20),
  ]);
  if (!studio) return <p className={ui.muted}>Select a studio to manage marketing.</p>;
  const locationId = effectiveLocationId ?? "";
  const draftCampaigns = (campaigns ?? []).filter((campaign) => campaign.status === "draft");
  return <div className="space-y-6">
    <div><h1 className={ui.h1}>Marketing</h1><p className={ui.muted}>Build consent-safe Email campaigns, send now or schedule in Singapore time, and review delivery results.</p></div>
    <DashboardLocationFilter selectedStudioId={studioId} selectedLocationId={effectiveLocationId} locations={(locations ?? []).filter((location) => accessibleLocationIds.includes(location.id))} allowAll={hasStudioWideAccess} />
    <ServerActionToastForm action={createMarketingCampaignAction} className="grid gap-4 rounded-2xl border border-stone-200 p-5 dark:border-stone-800 md:grid-cols-2">
      <input type="hidden" name="studio_id" value={studioId} /><input type="hidden" name="location_id" value={locationId} />
      <h2 className="md:col-span-2 text-lg font-semibold">New audience and Email draft</h2>
      <label className="flex flex-col gap-1 text-sm">Campaign name<input className={ui.input} name="name" maxLength={120} required /></label>
      <label className="flex flex-col gap-1 text-sm">Audience<select className={ui.input} name="audience_type" defaultValue="vip"><option value="vip">VIP — customer value</option><option value="frequent">Frequent — completed visits</option><option value="inactive">Inactive — no recent completed visit</option></select></label>
      <label className="flex flex-col gap-1 text-sm">VIP minimum value<input className={ui.input} name="min_value" type="number" min="0" step="0.01" defaultValue="1000" /></label>
      <label className="flex flex-col gap-1 text-sm">Frequent minimum visits<input className={ui.input} name="min_visits" type="number" min="1" step="1" defaultValue="3" /></label>
      <label className="flex flex-col gap-1 text-sm">Inactive days<input className={ui.input} name="inactive_days" type="number" min="1" step="1" defaultValue="90" /></label>
      <label className="flex flex-col gap-1 text-sm">Subject<input className={ui.input} name="subject" maxLength={180} required /></label>
      <label className="flex flex-col gap-1 text-sm md:col-span-2">Message<textarea className={ui.input} name="body" rows={6} maxLength={10000} required /></label>
      <label className="flex flex-col gap-1 text-sm">Image URL (optional)<input className={ui.input} name="image_url" type="url" placeholder="https://…" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="flex flex-col gap-1 text-sm">CTA label<input className={ui.input} name="cta_label" maxLength={80} /></label><label className="flex flex-col gap-1 text-sm">CTA URL<input className={ui.input} name="cta_url" type="url" placeholder="https://…" /></label></div>
      <div className="md:col-span-2"><SubmitButton className={ui.btnPrimary}>Create draft and snapshot</SubmitButton></div>
    </ServerActionToastForm>
    {draftCampaigns.length ? <ServerActionToastForm action={scheduleMarketingCampaignAction} className="grid gap-3 rounded-2xl border border-stone-200 p-5 dark:border-stone-800 md:grid-cols-2">
      <input type="hidden" name="studio_id" value={studioId} /><input type="hidden" name="location_id" value={locationId} /><h2 className="md:col-span-2 text-lg font-semibold">Send campaign</h2>
      <label className="flex flex-col gap-1 text-sm">Draft<select className={ui.input} name="campaign_id" required>{draftCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm">Timing<select className={ui.input} name="send_mode" defaultValue="now"><option value="now">Send now</option><option value="scheduled">Schedule (Asia/Singapore)</option></select></label>
      <label className="flex flex-col gap-1 text-sm">Scheduled date and time<input className={ui.input} name="scheduled_at" type="datetime-local" /></label>
      <div className="self-end"><SubmitButton className={ui.btnPrimary}>Confirm and queue</SubmitButton></div>
    </ServerActionToastForm> : null}
    <ServerActionToastForm action={sendMarketingTestEmailAction} className="grid gap-3 rounded-2xl border border-stone-200 p-5 dark:border-stone-800 md:grid-cols-2">
      <input type="hidden" name="studio_id" value={studioId} /><h2 className="md:col-span-2 text-lg font-semibold">Send a test email</h2>
      <label className="flex flex-col gap-1 text-sm">Test recipient<input className={ui.input} name="test_email" type="email" required /></label><label className="flex flex-col gap-1 text-sm">Subject<input className={ui.input} name="subject" required /></label>
      <label className="flex flex-col gap-1 text-sm md:col-span-2">Message<textarea className={ui.input} name="body" rows={3} required /></label>
      <label className="flex flex-col gap-1 text-sm">Image URL<input className={ui.input} name="image_url" type="url" /></label><div className="grid grid-cols-2 gap-3"><label className="flex flex-col gap-1 text-sm">CTA label<input className={ui.input} name="cta_label" /></label><label className="flex flex-col gap-1 text-sm">CTA URL<input className={ui.input} name="cta_url" type="url" /></label></div>
      <div className="md:col-span-2"><SubmitButton className={ui.btnPrimary}>Send test</SubmitButton></div>
    </ServerActionToastForm>
    <section><h2 className="mb-3 text-lg font-semibold">Campaigns and reports</h2>{campaigns?.length ? <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800"><table className="min-w-full text-sm"><thead><tr className="text-left text-stone-500"><th className="p-3">Name</th><th className="p-3">Audience</th><th className="p-3">Status</th><th className="p-3">Scheduled</th><th className="p-3">Report</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id} className="border-t border-stone-200 dark:border-stone-800"><td className="p-3">{campaign.name}</td><td className="p-3 capitalize">{campaign.audience_type}</td><td className="p-3 capitalize">{campaign.status}</td><td className="p-3">{campaign.scheduled_at ? new Date(campaign.scheduled_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) : "-"}</td><td className="p-3"><Link className="underline" href={`/dashboard/marketing/campaigns/${campaign.id}`}>View</Link></td></tr>)}</tbody></table></div> : <p className={ui.muted}>No campaigns yet.</p>}</section>
  </div>;
}
