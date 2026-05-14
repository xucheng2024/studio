import {
  updateStudioBasics,
  updateStudioPublicBranding,
  updateStudioPublicProfile,
  savePublicLogoUrl,
} from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { CoverUrlField, StudioProfileMediaFields } from "@/components/dashboard/PublicMediaFields";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(path: string, studioId: string | null, locationId: string | null) {
  const p = new URLSearchParams();
  if (studioId) p.set("studio_id", studioId);
  if (locationId) p.set("location_id", locationId);
  return p.toString() ? `${path}?${p.toString()}` : path;
}

export default async function StudioPublicProfilePage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const role = bestRole(ctx);
  if (!["owner", "manager"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  const studioId = selectedStudioId ?? studioIds[0] ?? null;
  if (!studioId) return <p className={ui.muted}>Create a studio first.</p>;

  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, public_brand_name, public_logo_url, public_intro, public_cover_image_url, public_video_url, public_services_title, public_classes_title, public_packages_title, public_events_title, public_member_zone_title, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Studio Public Profile</h1>
          <p className={ui.muted}>Edit the public landing page content shown at /{studio.public_slug}.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId, selectedLocationId)} className={ui.btnSecondarySm}>
          Back to settings
        </DashboardAppLink>
      </div>

      <form action={updateStudioBasics} className={`${ui.card} grid gap-3`}>
        <input type="hidden" name="studio_id" value={studio.id} />
        <h2 className={ui.h2}>Basic profile</h2>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Studio name</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            className={ui.input}
            defaultValue={studio.name ?? ""}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Public slug</span>
          <input
            name="public_slug"
            required
            minLength={3}
            maxLength={60}
            pattern="[a-zA-Z0-9\\-]+"
            defaultValue={studio.public_slug ?? ""}
            className={`${ui.input} font-mono text-sm`}
          />
          <p className={`text-xs ${ui.muted}`}>Public page: /{studio.public_slug ?? "your-slug"}</p>
        </label>
        <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-auto`} pendingText="Saving...">
          Save basics
        </SubmitButton>
      </form>

      <form action={updateStudioPublicBranding} className={`${ui.card} grid gap-4`}>
        <input type="hidden" name="studio_id" value={studio.id} />
        <div className="grid gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Header branding</h2>
            <p className={`text-xs ${ui.muted}`}>
              Controls the top row on your public page: left logo and center brand name.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
            <div className="grid gap-4">
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Brand name</span>
                <input
                  name="public_brand_name"
                  className={ui.input}
                  defaultValue={studio.public_brand_name ?? ""}
                  placeholder={studio.name ?? "Studio name"}
                />
                <p className={`text-xs ${ui.muted}`}>
                  Leave blank to use the studio name. Uploading a logo only updates the preview until you save.
                </p>
              </label>
            </div>
            <CoverUrlField
              studioId={studio.id}
              entityId="public-logo"
              folder="studios"
              name="public_logo_url"
              label="Brand logo"
              defaultValue={studio.public_logo_url ?? null}
              cropAspect={1}
              autoSaveAction={savePublicLogoUrl.bind(null, studio.id)}
            />
          </div>
        </div>
        <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Saving...">
          Save header branding
        </SubmitButton>
      </form>

      <form action={updateStudioPublicProfile} className={`${ui.card} grid gap-4`}>
        <input type="hidden" name="studio_id" value={studio.id} />
        <StudioProfileMediaFields
          studioId={studio.id}
          coverDefaultValue={studio.public_cover_image_url}
          videoDefaultValue={studio.public_video_url}
          studioName={studio.name}
        />
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Intro</span>
          <textarea
            name="public_intro"
            rows={5}
            className={`${ui.input} min-h-32`}
            defaultValue={studio.public_intro ?? ""}
            placeholder="Tell visitors about your studio."
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Services section title</span>
            <input name="public_services_title" className={ui.input} defaultValue={studio.public_services_title ?? ""} placeholder="General services" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Classes section title</span>
            <input name="public_classes_title" className={ui.input} defaultValue={studio.public_classes_title ?? ""} placeholder="Upcoming classes" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Packages section title</span>
            <input name="public_packages_title" className={ui.input} defaultValue={studio.public_packages_title ?? ""} placeholder="Packages" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Events section title</span>
            <input name="public_events_title" className={ui.input} defaultValue={(studio as { public_events_title?: string | null }).public_events_title ?? ""} placeholder="Events" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Members section title</span>
            <input name="public_member_zone_title" className={ui.input} defaultValue={(studio as { public_member_zone_title?: string | null }).public_member_zone_title ?? ""} placeholder="Member zone" />
          </label>
        </div>

        <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">WhatsApp contact</h2>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="whatsapp_enabled" defaultChecked={Boolean(studio.whatsapp_enabled)} />
            Enable WhatsApp button
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>WhatsApp number (E.164)</span>
              <input name="whatsapp_number_e164" className={ui.input} defaultValue={studio.whatsapp_number_e164 ?? ""} placeholder="+6591234567" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Prefill message</span>
              <input
                name="whatsapp_prefill_text"
                className={ui.input}
                defaultValue={studio.whatsapp_prefill_text ?? ""}
                placeholder="Hi, I'm interested in your services."
              />
            </label>
          </div>
        </div>

        <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Saving...">
          Save public profile
        </SubmitButton>
      </form>
    </div>
  );
}
