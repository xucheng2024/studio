import Link from "next/link";
import { createStaffInvite, revokeStaffInvite } from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ invite_error?: string; invite_success?: string }>;
};

export default async function StaffInvitesPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: studios } = await supabase
    .from("studios")
    .select("id, name, locations(id, name)")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  const studioIds = (studios ?? []).map((s) => s.id);
  const { data: invites } = studioIds.length
    ? await supabase
        .from("staff_invites")
        .select("id, studio_id, location_id, email, role, status, token, expires_at, created_at")
        .in("studio_id", studioIds)
        .order("created_at", { ascending: false })
    : { data: [] as Array<Record<string, unknown>> };

  const errorMsg =
    sp.invite_error === "missing_required_fields"
      ? "Please complete email, role, and studio."
      : sp.invite_error === "invalid_role"
        ? "Invalid role."
        : sp.invite_error === "forbidden"
          ? "Only studio owners can send invites."
          : sp.invite_error === "invalid_location_scope"
            ? "Location does not belong to selected studio."
            : sp.invite_error === "create_failed"
              ? "Could not create invite. An active invite may already exist."
              : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Staff invites</h1>
        <p className={ui.muted}>Workspace access is managed by invitation.</p>
      </div>

      <form action={createStaffInvite} className={`${ui.card} grid gap-3 md:grid-cols-2`}>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Email</span>
          <input name="email" type="email" className={ui.input} required placeholder="staff@studio.com" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Role</span>
          <select name="role" className={ui.input} required>
            <option value="manager">Manager</option>
            <option value="frontdesk">Frontdesk</option>
            <option value="instructor">Instructor</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Studio</span>
          <select name="studio_id" className={ui.input} required>
            <option value="">Select a studio</option>
            {(studios ?? []).map((studio) => (
              <option key={studio.id} value={studio.id}>
                {studio.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Location (optional)</span>
          <select name="location_id" className={ui.input}>
            <option value="">All locations</option>
            {(studios ?? []).flatMap((studio) => {
              const locations = Array.isArray(studio.locations) ? studio.locations : [];
              return locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {studio.name} - {loc.name}
                </option>
              ));
            })}
          </select>
        </label>
        <div className="md:col-span-2">
          <SubmitButton className={ui.btnPrimary} pendingText="Sending...">
            Send invite
          </SubmitButton>
        </div>
        {sp.invite_success === "sent" ? <p className={`${ui.success} md:col-span-2`}>Invite created.</p> : null}
        {errorMsg ? <p className={`${ui.error} md:col-span-2`}>{errorMsg}</p> : null}
      </form>

      <section className={`${ui.card} overflow-x-auto`}>
        <h2 className={`${ui.h2} mb-3`}>Invites</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Link</th>
              <th className="py-2 pr-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {(invites as Array<{ id: string; email: string; role: string; status: string; token: string; expires_at: string }>).map(
              (invite) => (
                <tr key={invite.id} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="py-2 pr-4">{invite.email}</td>
                  <td className="py-2 pr-4 capitalize">{invite.role}</td>
                  <td className="py-2 pr-4">{invite.status}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/auth?invite_token=${invite.token}`} className={ui.link}>
                      Open invite link
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {invite.status === "pending" ? (
                      <form action={revokeStaffInvite}>
                        <input type="hidden" name="invite_id" value={invite.id} />
                        <SubmitButton className={ui.btnGhost} pendingText="Revoking...">
                          Revoke
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className={ui.muted}>-</span>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
