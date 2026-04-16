import { createStaffMembership, toggleStaffMembership } from "@/app/dashboard/actions";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { bestRole, buildAccessContext } from "@/lib/rbac";

export default async function StaffPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx = await buildAccessContext({ userId: user.id });
  if (bestRole(ctx) !== "owner") {
    return <p className={ui.muted}>Only owners can manage staff.</p>;
  }

  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  const { data: studios } = await supabase
    .from("studios")
    .select("id, name")
    .in("id", studioIds)
    .order("name");
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, studio_id")
    .in("studio_id", studioIds)
    .eq("is_active", true)
    .order("name");
  const { data: staff } = await supabase
    .from("staff_memberships")
    .select("id, user_id, studio_id, location_id, role, is_active, created_at")
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Staff</h1>
        <p className={`mt-1 ${ui.muted}`}>Basic RBAC memberships by studio and location.</p>
      </div>
      <form action={createStaffMembership} className={`${ui.card} grid gap-3 md:grid-cols-2`}>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>User ID</span>
          <input name="user_id" required className={ui.input} placeholder="UUID from auth user" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Role</span>
          <select name="role" className={ui.select} defaultValue="frontdesk">
            <option value="manager">manager</option>
            <option value="frontdesk">frontdesk</option>
            <option value="instructor">instructor</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Studio</span>
          <select name="studio_id" className={ui.select}>
            {(studios ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Location (optional)</span>
          <select name="location_id" className={ui.select} defaultValue="">
            <option value="">All locations</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button className={`${ui.btnPrimary} w-fit`} type="submit">
          Add staff membership
        </button>
      </form>
      <div className={ui.card}>
        <p className={`mb-2 text-xs ${ui.muted}`}>On phone, swipe horizontally to view all columns.</p>
        <div className="overflow-auto">
          <table className="min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Studio</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {(staff ?? []).map((s) => (
              <tr key={s.id} className="border-t border-stone-200/70 dark:border-stone-800/70">
                <td className="px-3 py-2">{s.role}</td>
                <td className="px-3 py-2 font-mono text-xs">{s.user_id}</td>
                <td className="px-3 py-2 font-mono text-xs">{s.studio_id}</td>
                <td className="px-3 py-2 font-mono text-xs">{s.location_id ?? "all"}</td>
                <td className="px-3 py-2">
                  <form action={toggleStaffMembership}>
                    <input type="hidden" name="membership_id" value={s.id} />
                    <input type="hidden" name="next_active" value={String(!s.is_active)} />
                    <button type="submit" className={ui.linkMuted} disabled={s.role === "owner"}>
                      {s.is_active ? "Disable" : "Enable"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
