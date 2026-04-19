import {
  createLocation,
  toggleLocationActive,
  updateLocation,
} from "@/app/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{
    studio_id?: string;
    location_id?: string;
    loc_error?: string;
    loc_success?: string;
  }>;
};

function scopedHref(path: string, selectedStudioId: string | null, selectedLocationId: string | null) {
  const p = new URLSearchParams();
  if (selectedStudioId) p.set("studio_id", selectedStudioId);
  if (selectedLocationId) p.set("location_id", selectedLocationId);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

export default async function SettingsLocationsPage({ searchParams }: Props) {
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
  const role = bestRole(ctx);
  if (!["owner", "manager"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (studioIds.length === 0) return <p className={ui.muted}>Create a studio first.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const { data: studio } = await supabase
    .from("studios")
    .select("id, name")
    .eq("id", activeStudioId)
    .maybeSingle();
  if (!studio) {
    return <p className={ui.muted}>Studio not found.</p>;
  }
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, address, phone, is_active, created_at")
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: true });

  const errorMsg =
    sp.loc_error === "missing_required_fields"
      ? "Please fill the required fields."
      : sp.loc_error === "forbidden"
        ? "Only owners can manage locations."
        : sp.loc_error === "studio_suspended"
          ? "Studio is suspended. Set contract back to active first."
          : sp.loc_error === "create_failed"
            ? "Could not create location."
            : sp.loc_error === "save_failed"
              ? "Could not save location."
              : sp.loc_error === "not_found"
                ? "Location was not found."
                : null;
  const successMsg =
    sp.loc_success === "created"
      ? "Location created."
      : sp.loc_success === "updated"
        ? "Location updated."
        : sp.loc_success === "status_updated"
          ? "Location status updated."
          : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className={ui.h1}>Locations</h1>
          <p className={ui.muted}>Manage branches/venues for {studio.name}.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId, selectedLocationId)} className={ui.btnSecondarySm}>
          Back to settings
        </DashboardAppLink>
      </div>

      {errorMsg ? <p className={ui.error}>{errorMsg}</p> : null}
      {successMsg ? <p className={ui.success}>{successMsg}</p> : null}

      {role === "owner" ? (
        <form action={createLocation} className={`${ui.card} grid gap-3 md:grid-cols-2`}>
          <input type="hidden" name="studio_id" value={studio.id} />
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className={ui.label}>Location name</span>
            <input name="name" required className={ui.input} placeholder="Downtown" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Address (optional)</span>
            <input name="address" className={ui.input} placeholder="123 Main St" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Phone (optional)</span>
            <input name="phone" type="tel" inputMode="tel" className={ui.input} placeholder="+65 9123 4567" />
          </label>
          <div className="md:col-span-2">
            <SubmitButton className={ui.btnPrimary} pendingText="Creating...">
              Add location
            </SubmitButton>
          </div>
        </form>
      ) : (
        <p className={ui.muted}>Manager view is read-only. Ask the owner to add or edit locations.</p>
      )}

      <div className={ui.card}>
        <p className={`mb-3 text-xs ${ui.muted}`}>Locations are used for schedule/frontdesk/operations filters and scoped staff access.</p>
        {(locations ?? []).length === 0 ? (
          <p className={`text-sm ${ui.muted}`}>No locations added yet. Add one above to enable per-location filtering and scoped staff access.</p>
        ) : (
          <div className="space-y-3">
            {(locations ?? []).map((loc) => (
              <div key={loc.id} className="rounded-xl border border-stone-200/80 p-3 dark:border-stone-800/80">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-medium text-stone-900 dark:text-stone-100">{loc.name}</p>
                  <span
                    className={
                      loc.is_active
                        ? "rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                        : "rounded-md bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                    }
                  >
                    {loc.is_active ? "Active" : "Disabled"}
                  </span>
                </div>
                {role === "owner" ? (
                  <form action={updateLocation} className="grid gap-2 md:grid-cols-3">
                    <input type="hidden" name="location_id" value={loc.id} />
                    <input name="name" required defaultValue={loc.name} className={ui.input} />
                    <input name="address" defaultValue={loc.address ?? ""} className={ui.input} placeholder="Address" />
                    <div className="flex gap-2">
                      <input name="phone" type="tel" inputMode="tel" defaultValue={loc.phone ?? ""} className={ui.input} placeholder="+65 9123 4567" />
                      <SubmitButton className={ui.btnSecondarySm} pendingText="Saving...">
                        Save
                      </SubmitButton>
                    </div>
                  </form>
                ) : (
                  <p className={`text-sm ${ui.muted}`}>
                    {loc.address ? `${loc.address} · ` : ""}
                    {loc.phone ?? "No phone"}
                  </p>
                )}
                {role === "owner" ? (
                  <form action={toggleLocationActive} className="mt-2">
                    <input type="hidden" name="location_id" value={loc.id} />
                    <input type="hidden" name="next_active" value={loc.is_active ? "false" : "true"} />
                    <SubmitButton className={loc.is_active ? ui.btnGhost : ui.btnSecondarySm} pendingText="Updating...">
                      {loc.is_active ? "Disable" : "Enable"}
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

