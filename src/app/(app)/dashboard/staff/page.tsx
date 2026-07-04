import { toggleStaffMembership } from "@/app/(app)/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { DashboardLocationFilter } from "@/components/DashboardLocationFilter";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { getDashboardScopeForRoles } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
 
type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(path: string, studioId: string | null, locationId: string | null) {
  const params = new URLSearchParams();
  if (studioId) params.set("studio_id", studioId);
  if (locationId) params.set("location_id", locationId);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export default async function StaffPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { studioIds, selectedStudioId, selectedLocationId } = await getDashboardScopeForRoles({
    userId: user.id,
    email: user.email,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  }, ["owner"]);
  if (studioIds.length === 0) {
    return <p className={ui.muted}>Only owners can manage staff.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }

  const studioId = selectedStudioId ?? studioIds[0];
  const admin = createAdminClient();
  const { data: locationRows } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .eq("studio_id", studioId)
    .eq("is_active", true)
    .order("name");
  const { data: staff } = await admin
    .from("staff_memberships")
    .select("id, user_id, studio_id, location_id, role, is_active, created_at, users(email)")
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false });
  const filteredStaff = selectedLocationId
    ? (staff ?? []).filter((membership) => membership.location_id == null || membership.location_id === selectedLocationId)
    : (staff ?? []);

  return (
    <div className="flex flex-col gap-6">
      <div className={`${ui.card} flex flex-wrap gap-3`}>
        <DashboardLocationFilter
          locations={locationRows ?? []}
          selectedStudioId={studioId}
          selectedLocationId={selectedLocationId}
        />
      </div>
      <div>
        <h1 className={ui.h1}>Staff</h1>
        <p className={`mt-1 ${ui.muted}`}>Workspace access is managed by invitation.</p>
      </div>
      <div className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={ui.muted}>Send invites to grant staff access. Accepted invites appear below.</p>
          <DashboardAppLink href={scopedHref("/dashboard/settings/staff-invites", selectedStudioId, selectedLocationId)} className={ui.btnPrimary}>
            Open staff invites
          </DashboardAppLink>
        </div>
      </div>
      <div className={ui.card}>
        {!filteredStaff.length ? (
          <p className={`text-sm ${ui.muted}`}>No staff members yet. Send an invite to get started.</p>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {filteredStaff.map((s) => {
              const email =
                ((Array.isArray(s.users) ? s.users[0] : s.users) as { email?: string | null } | null)?.email ??
                s.user_id;
              const roleBg = s.role === "owner"
                ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                : s.role === "manager"
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300";
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${roleBg}`}>
                        {s.role}
                      </span>
                      {!s.is_active ? (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-500 dark:bg-red-950/40 dark:text-red-400">
                          disabled
                        </span>
                      ) : null}
                    </div>
                    <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{email}</span>
                    <span className={`text-xs ${ui.muted}`}>
                      {s.location_id ? `Location-scoped` : "All locations"}
                    </span>
                  </div>
                  <ServerActionToastForm action={toggleStaffMembership}>
                    <input type="hidden" name="membership_id" value={s.id} />
                    <input type="hidden" name="next_active" value={String(!s.is_active)} />
                    <button
                      type="submit"
                      className={`${s.is_active ? ui.btnGhost : ui.btnSecondarySm} text-xs`}
                      disabled={s.role === "owner"}
                    >
                      {s.is_active ? "Disable" : "Enable"}
                    </button>
                  </ServerActionToastForm>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
