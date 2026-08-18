import { updateStudioContractSettings } from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { toLocalDateTimeInputValue } from "@/lib/date";
import { getDashboardScope } from "@/lib/dashboard";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import {
  Building2, CreditCard, Mail, Users, MapPin, ShieldCheck, HelpCircle, Globe, CalendarDays, BriefcaseBusiness,
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

function scopedHref(path: string, selectedStudioId: string | null) {
  const p = new URLSearchParams();
  if (selectedStudioId) p.set("studio_id", selectedStudioId);
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

  const { ctx, studioIds, selectedStudioId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: null,
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
        <p className={ui.muted}>Self-service studio setup for public page, booking, payments, staff, and locations.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/public-profile", selectedStudioId)}
          icon={Building2}
          title="Studio profile"
          desc="Edit public intro, media, social links, and contact details"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/booking", selectedStudioId)}
          icon={CalendarDays}
          title="Booking settings"
          desc="Connect Cal.com, save the event URL, and control booking on your public page"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/custom-domain", selectedStudioId)}
          icon={Globe}
          title="Custom domain"
          desc="Connect your own domain, review DNS instructions, and verify activation"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/payments", selectedStudioId)}
          icon={CreditCard}
          title="Payment settings"
          desc="Enter studio HitPay credentials, check platform readiness, and enable checkout"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/email", selectedStudioId)}
          icon={Mail}
          title="Email settings"
          desc="Enter this studio Resend API key, From address, and webhook secret"
        />
        {isStudioOwner ? (
          <SettingCard
            as={DashboardAppLink}
            href={scopedHref("/dashboard/settings/staff-invites", selectedStudioId)}
            icon={Users}
            title="Staff & roles"
            desc="Create invite links, assign roles, and manage access"
          />
        ) : null}
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/staff-availability", selectedStudioId)}
          icon={CalendarDays}
          title="Staff availability"
          desc="Set employee working hours and one-off availability exceptions"
        />
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/resources", selectedStudioId)}
          icon={BriefcaseBusiness}
          title="Resources"
          desc="Manage rooms, beds, and equipment for each location"
        />
        {canManageStudio ? (
          <SettingCard
            as={DashboardAppLink}
            href={scopedHref("/dashboard/settings/locations", selectedStudioId)}
            icon={MapPin}
            title="Locations"
            desc="Edit locations (owner) and weekly operating hours (owner/manager)"
          />
        ) : null}
        {isStudioOwner ? (
          <SettingCard
            as={DashboardAppLink}
            href={scopedHref("/dashboard/settings/faqs", selectedStudioId)}
            icon={HelpCircle}
            title="Public FAQs"
            desc="Manage the FAQ accordion shown at the bottom of your public studio page"
          />
        ) : null}
        <SettingCard
          as={DashboardAppLink}
          href={scopedHref("/dashboard/settings/privacy", selectedStudioId)}
          icon={ShieldCheck}
          title="Privacy & data"
          desc="Privacy notice version, retention rules, and processor list"
        />
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
        <ServerActionToastForm action={updateStudioContractSettings} className={`${ui.card} flex max-w-lg flex-col gap-3`}>
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
        </ServerActionToastForm>
      ) : null}
      {!isSuperAdmin && !isStudioOwner ? (
        <p className={`text-sm ${ui.muted}`}>
          Manager view: owner-only settings may be visible as read-only depending on page rules.
        </p>
      ) : null}
    </div>
  );
}
