import { DashboardAppLink } from "@/components/DashboardAppLink";
import { BookingSettingsForm } from "@/components/dashboard/BookingSettingsForm";
import { getDashboardScope } from "@/lib/dashboard";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(path: string, studioId: string | null) {
  const p = new URLSearchParams();
  if (studioId) p.set("studio_id", studioId);
  return p.toString() ? `${path}?${p.toString()}` : path;
}

export default async function StudioBookingSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId } = await getDashboardScope({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: null,
  });
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const studioId = selectedStudioId ?? studioIds[0] ?? null;
  if (!studioId) return <p className={ui.muted}>Create a studio first.</p>;
  const canManageStudio =
    ctx.isSuperAdmin
    || ctx.memberships.some(
      (m) => m.studio_id === studioId && (m.role === "owner" || m.role === "manager"),
    );
  if (!canManageStudio) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug, calcom_booking_enabled, calcom_embed_url")
    .eq("id", studioId)
    .maybeSingle();
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Booking settings</h1>
          <p className={ui.muted}>Connect Cal.com and control how booking appears on /{studio.public_slug}.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId)} className={ui.btnSecondarySm}>
          Back to settings
        </DashboardAppLink>
      </div>

      <BookingSettingsForm
        studioId={studio.id}
        initialEnabled={Boolean((studio as { calcom_booking_enabled?: boolean }).calcom_booking_enabled)}
        initialUrl={(studio as { calcom_embed_url?: string | null }).calcom_embed_url ?? null}
      />
    </div>
  );
}
