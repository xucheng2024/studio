import { updateStudioContractSettings } from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { toLocalDateTimeInputValue } from "@/lib/date";
import { getDashboardScope } from "@/lib/dashboard";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import {
  Building2, CreditCard, Users, MapPin, ShieldCheck, HelpCircle, Globe, CalendarDays,
  type LucideIcon,
} from "lucide-react";

function SettingCard({
  as: Tag,
  href,
  icon: Icon,
  title,
  desc,
  className,
}: {
  as: React.ElementType;
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  className?: string;
}) {
  return (
    <Tag
      href={href}
      className={`group flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800 dark:bg-stone-900 ${className ?? ""}`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 transition-colors group-hover:bg-teal-50 group-hover:text-teal-700 dark:bg-stone-800 dark:text-stone-400 dark:group-hover:bg-teal-950/40 dark:group-hover:text-teal-400">
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-stone-500 dark:text-stone-400">{desc}</span>
      </span>
    </Tag>
  );
}

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(
  path: string,
  selectedStudioId: string | null,
  selectedLocationId: string | null,
) {
  const p = new URLSearchParams();
  if (selectedStudioId) p.set("studio_id", selectedStudioId);
  if (selectedLocationId) p.set("location_id", selectedLocationId);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

export default async function DashboardSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const isSuperAdmin = isSuperAdminEmail(user.email);

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (studioIds.length === 0 && !isSuperAdmin) return <p className={ui.muted}>Create a studio first.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const studioId = selectedStudioId ?? studioIds[0] ?? null;
  const canManageStudio =
    isSuperAdmin
    || (studioId != null
      && ctx.memberships.some(
        (m) => m.studio_id === studioId && (m.role === "owner" || m.role === "manager"),
      ));
  const isStudioOwner =
    studioId != null
    && ctx.memberships.some((m) => m.studio_id === studioId && m.role === "owner");
  if (!canManageStudio) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const contractStudioId = isSuperAdmin ? (sp.studio_id ?? selectedStudioId) : null;
  let contractStudio: {
    id: string;
    contract_status: string | null;
    contract_ends_at: string | null;
  } | null = null;
  if (contractStudioId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("studios")
      .select("id, contract_status, contract_ends_at")
      .eq("id", contractStudioId)
      .maybeSingle();
    contractStudio = data;
  }

  const endsLocal = toLocalDateTimeInputValue(contractStudio?.contract_ends_at);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Settings</h1>
        <p className={ui.muted}>Studio-level configuration and admin tools.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/public-profile", selectedStudioId, selectedLocationId)}
          icon={Building2}
          title="Studio profile"
          desc="Edit public intro, media, social links, and contact details"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/booking", selectedStudioId, selectedLocationId)}
          icon={CalendarDays}
          title="Booking settings"
          desc="Connect Cal.com, save the event URL, and control booking on your public page"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/custom-domain", selectedStudioId, selectedLocationId)}
          icon={Globe}
          title="Custom domain"
          desc="Connect your own domain, review DNS instructions, and verify activation"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/payments", selectedStudioId, selectedLocationId)}
          icon={CreditCard}
          title="Payment settings"
          desc="HitPay platform status, sub-merchant credentials, and webhook configuration"
        />
        {isStudioOwner ? (
          <SettingCard
            as={DashboardAppLink}
            href={scopedHref("/dashboard/settings/staff-invites", selectedStudioId, selectedLocationId)}
            icon={Users}
            title="Staff & roles"
            desc="Invite staff, assign roles, and manage access"
          />
        ) : null}
        {isStudioOwner ? (
          <SettingCard
            as={DashboardAppLink}
            href={scopedHref("/dashboard/settings/locations", selectedStudioId, selectedLocationId)}
            icon={MapPin}
            title="Locations"
            desc="Add or edit studio locations and addresses"
          />
        ) : null}
        {isStudioOwner ? (
          <SettingCard
            as={DashboardAppLink}
            href={scopedHref("/dashboard/settings/faqs", selectedStudioId, selectedLocationId)}
            icon={HelpCircle}
            title="Public FAQs"
            desc="Manage the FAQ accordion shown at the bottom of your public studio page"
          />
        ) : null}
        {isSuperAdmin ? (
          <SettingCard
            as={DashboardAppLink}
            href="/dashboard/settings/owners"
            icon={ShieldCheck}
            title="Platform owner access"
            desc="Super-admin tools and studio management"
          />
        ) : null}
      </div>
      {isSuperAdmin && contractStudio ? (
        <form action={updateStudioContractSettings} className={`${ui.card} flex max-w-lg flex-col gap-3`}>
          <input type="hidden" name="studio_id" value={contractStudio.id} />
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Studio contract</h2>
            <p className={`mt-1 text-sm ${ui.muted}`}>
              Manual switch for B2B lifecycle. When set to suspended, day-to-day operations and booking APIs for this
              studio are blocked until you set it back to active.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Contract status</span>
            <select name="contract_status" defaultValue={contractStudio.contract_status ?? "active"} className={ui.select}>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Contract ends — SGT (optional)</span>
            <input
              name="contract_ends_at"
              type="datetime-local"
              defaultValue={endsLocal}
              className={ui.input}
            />
            <span className={`text-xs ${ui.muted}`}>Leave empty to clear. Stored in UTC.</span>
          </label>
          <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Saving...">
            Save contract
          </SubmitButton>
        </form>
      ) : null}
      {!isSuperAdmin && !isStudioOwner ? (
        <p className={`text-sm ${ui.muted}`}>
          Manager view: owner-only settings may be visible as read-only depending on page rules.
        </p>
      ) : null}
    </div>
  );
}
