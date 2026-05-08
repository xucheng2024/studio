import Link from "next/link";
import { createStaffInvite, revokeStaffInvite } from "@/app/(app)/dashboard/actions";
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
              : sp.invite_error === "studio_suspended"
                ? "This studio is suspended. Set contract to active in Settings before sending invites."
                : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard/settings" className={`${ui.btnSecondarySm} mb-3 inline-flex`}>
          ← Settings
        </Link>
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
          <select name="role" className={ui.select} required>
            <option value="manager">Manager</option>
            <option value="frontdesk">Frontdesk</option>
            <option value="instructor">Instructor</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Studio</span>
          <select name="studio_id" className={ui.select} required>
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
          <select name="location_id" className={ui.select}>
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
          <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Sending...">
            Send invite
          </SubmitButton>
        </div>
        {sp.invite_success === "sent" ? <p className={`${ui.success} md:col-span-2`}>Invite created.</p> : null}
        {errorMsg ? <p className={`${ui.error} md:col-span-2`}>{errorMsg}</p> : null}
      </form>

      <section className={ui.card}>
        <h2 className={`${ui.h2} mb-3`}>Invites</h2>
        {!(invites as unknown[]).length ? (
          <p className={`text-sm ${ui.muted}`}>No invites sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {(invites as Array<{ id: string; email: string; role: string; status: string; token: string; expires_at: string }>).map(
              (invite) => {
                const statusBg = invite.status === "pending"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  : invite.status === "accepted"
                    ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                    : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400";
                return (
                  <li key={invite.id} className="rounded-xl border border-stone-100 px-3 py-3 dark:border-stone-800">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{invite.email}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs capitalize text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                          {invite.role}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBg}`}>
                          {invite.status}
                        </span>
                      </div>
                      <Link href={`/auth?invite_token=${invite.token}`} className={`text-xs ${ui.link}`}>
                        Open invite link →
                      </Link>
                    </div>
                    <div className="mt-2 shrink-0">
                      {invite.status === "pending" ? (
                        <form action={revokeStaffInvite}>
                          <input type="hidden" name="invite_id" value={invite.id} />
                          <SubmitButton className={`${ui.btnGhost} w-full sm:w-auto`} pendingText="Revoking...">
                            Revoke
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className={`text-xs ${ui.muted}`}>—</span>
                      )}
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
