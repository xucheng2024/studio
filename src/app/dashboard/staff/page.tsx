import { toggleStaffMembership } from "@/app/dashboard/actions";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { bestRole, buildAccessContext } from "@/lib/rbac";

type Props = { searchParams: Promise<{ staff_error?: string }> };

export default async function StaffPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx = await buildAccessContext({ userId: user.id, email: user.email });
  if (bestRole(ctx) !== "owner") {
    return <p className={ui.muted}>Only owners can manage staff.</p>;
  }

  const studioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
  const { data: staff } = await supabase
    .from("staff_memberships")
    .select("id, user_id, studio_id, location_id, role, is_active, created_at, users(email)")
    .in("studio_id", studioIds)
    .order("created_at", { ascending: false });

  const staffErrorMsg =
    sp.staff_error === "studio_suspended"
      ? "This studio is suspended. Set contract back to active in Settings before adding staff."
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Staff</h1>
        <p className={`mt-1 ${ui.muted}`}>Workspace access is managed by invitation.</p>
      </div>
      {staffErrorMsg ? <p className={ui.error}>{staffErrorMsg}</p> : null}
      <div className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={ui.muted}>Send invites to grant staff access. Accepted invites appear below.</p>
          <DashboardAppLink href="/dashboard/settings/staff-invites" className={ui.btnPrimary}>
            Open staff invites
          </DashboardAppLink>
        </div>
      </div>
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
                <td className="px-3 py-2 text-xs">
                  {(
                    ((Array.isArray(s.users) ? s.users[0] : s.users) as { email?: string | null } | null)?.email ??
                    s.user_id
                  )}
                </td>
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
