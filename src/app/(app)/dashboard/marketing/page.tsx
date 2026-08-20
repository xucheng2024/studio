import Link from "next/link";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { DashboardTabNav } from "@/components/dashboard/DashboardTabNav";
import { MarketingAudienceFields, MarketingOptionalContent, MarketingSendTimingFields } from "@/components/dashboard/MarketingComposeFields";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { createMarketingCampaignAction, scheduleMarketingCampaignAction, sendMarketingTestEmailAction } from "@/app/(app)/dashboard/actions";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string; tab?: string }> };

function marketingHref(params: { studioId: string; locationId?: string | null; tab?: string }) {
  const query = new URLSearchParams();
  query.set("studio_id", params.studioId);
  if (params.locationId) query.set("location_id", params.locationId);
  if (params.tab) query.set("tab", params.tab);
  return `/dashboard/marketing?${query.toString()}`;
}

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
  const scopeHref = { studioId, locationId: effectiveLocationId };
  const activeTab = sp.tab === "campaigns" ? "campaigns" : "compose";
  return <div className="space-y-6">
    <div><h1 className={ui.h1}>Marketing</h1><p className={ui.muted}>Build consent-safe Email campaigns, send now or schedule in Singapore time, and review delivery results.</p></div>
    <DashboardLocationFilter selectedStudioId={studioId} selectedLocationId={effectiveLocationId} locations={(locations ?? []).filter((location) => accessibleLocationIds.includes(location.id))} allowAll={hasStudioWideAccess} />
    <DashboardTabNav
      ariaLabel="Marketing sections"
      activeKey={activeTab}
      tabs={[
        { key: "compose", label: "Compose", href: marketingHref(scopeHref) },
        { key: "campaigns", label: "Campaigns", href: marketingHref({ ...scopeHref, tab: "campaigns" }) },
      ]}
    />
    {activeTab === "compose" ? <>
    <ServerActionToastForm action={createMarketingCampaignAction} className="grid gap-4 rounded-2xl border border-stone-200 p-5 dark:border-stone-800 md:grid-cols-2">
      <input type="hidden" name="studio_id" value={studioId} /><input type="hidden" name="location_id" value={locationId} />
      <h2 className="md:col-span-2 text-lg font-semibold">New audience and Email draft</h2>
      <label className="flex flex-col gap-1 text-sm">Campaign name<input className={ui.input} name="name" maxLength={120} required /></label>
      <MarketingAudienceFields />
      <label className="flex flex-col gap-1 text-sm">Subject<input className={ui.input} name="subject" maxLength={180} required /></label>
      <label className="flex flex-col gap-1 text-sm md:col-span-2">Message<textarea className={ui.input} name="body" rows={6} maxLength={10000} required /></label>
      <MarketingOptionalContent />
      <div className="md:col-span-2"><SubmitButton className={ui.btnPrimary}>Create draft and snapshot</SubmitButton></div>
    </ServerActionToastForm>
    {draftCampaigns.length ? <ServerActionToastForm action={scheduleMarketingCampaignAction} className="grid gap-3 rounded-2xl border border-stone-200 p-5 dark:border-stone-800 md:grid-cols-2">
      <input type="hidden" name="studio_id" value={studioId} /><input type="hidden" name="location_id" value={locationId} /><h2 className="md:col-span-2 text-lg font-semibold">Send campaign</h2>
      <label className="flex flex-col gap-1 text-sm">Draft<select className={ui.input} name="campaign_id" required>{draftCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
      <MarketingSendTimingFields />
      <div className="self-end"><SubmitButton className={ui.btnPrimary}>Confirm and queue</SubmitButton></div>
    </ServerActionToastForm> : null}
    <ServerActionToastForm action={sendMarketingTestEmailAction} className="grid gap-3 rounded-2xl border border-stone-200 p-5 dark:border-stone-800 md:grid-cols-2">
      <input type="hidden" name="studio_id" value={studioId} /><h2 className="md:col-span-2 text-lg font-semibold">Send a test email</h2>
      <label className="flex flex-col gap-1 text-sm">Test recipient<input className={ui.input} name="test_email" type="email" required /></label><label className="flex flex-col gap-1 text-sm">Subject<input className={ui.input} name="subject" required /></label>
      <label className="flex flex-col gap-1 text-sm md:col-span-2">Message<textarea className={ui.input} name="body" rows={3} required /></label>
      <label className="flex flex-col gap-1 text-sm">Image URL<input className={ui.input} name="image_url" type="url" /></label><div className="grid grid-cols-2 gap-3"><label className="flex flex-col gap-1 text-sm">CTA label<input className={ui.input} name="cta_label" /></label><label className="flex flex-col gap-1 text-sm">CTA URL<input className={ui.input} name="cta_url" type="url" /></label></div>
      <div className="md:col-span-2"><SubmitButton className={ui.btnPrimary}>Send test</SubmitButton></div>
    </ServerActionToastForm>
    </> : null}
    {activeTab === "campaigns" ? <section>{campaigns?.length ? <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800"><table className="min-w-full text-sm"><thead><tr className="text-left text-stone-500"><th className="p-3">Name</th><th className="p-3">Audience</th><th className="p-3">Status</th><th className="p-3">Scheduled</th><th className="p-3">Report</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id} className="border-t border-stone-200 dark:border-stone-800"><td className="p-3">{campaign.name}</td><td className="p-3 capitalize">{campaign.audience_type}</td><td className="p-3 capitalize">{campaign.status}</td><td className="p-3">{campaign.scheduled_at ? new Date(campaign.scheduled_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) : "-"}</td><td className="p-3"><Link className="underline" href={`/dashboard/marketing/campaigns/${campaign.id}`}>View</Link></td></tr>)}</tbody></table></div> : <p className={ui.muted}>No campaigns yet.</p>}</section> : null}
  </div>;
}
