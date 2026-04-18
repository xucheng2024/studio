import {
  grantOwnerAccessByEmail,
  setPlatformOwnerGrantActive,
} from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{
    owner_error?: string;
    owner_success?: string;
    owner_grant_updated?: string;
  }>;
};

export default async function OwnerAccessAdminPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!isSuperAdminEmail(user.email)) {
    return <p className={ui.muted}>You do not have platform admin access.</p>;
  }

  const admin = createAdminClient();
  const { data: grants } = await admin
    .from("platform_owner_grants")
    .select("user_id, is_active, created_at, users(email)")
    .order("created_at", { ascending: false });

  type GrantRow = {
    user_id: string;
    is_active: boolean;
    created_at: string;
    users: { email: string | null } | { email: string | null }[] | null;
  };

  const rows = (grants ?? []) as GrantRow[];
  const errorMsg =
    sp.owner_error === "email_not_registered"
      ? "Email has no account yet. Ask user to sign in once first."
      : sp.owner_error === "save_failed"
        ? "Could not save owner access."
        : sp.owner_error === "invalid_email"
          ? "Please enter a valid email."
          : sp.owner_error === "invalid_user"
            ? "Invalid user reference."
            : sp.owner_error === "forbidden"
              ? "Forbidden."
              : null;

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Platform owner access</h1>
        <p className={ui.muted}>Super admin only. Grant owner workspace access by email, or enable/disable existing grants.</p>
      </div>
      <form action={grantOwnerAccessByEmail} className={`${ui.card} flex flex-col gap-3`}>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Owner email</span>
          <input name="email" type="email" required className={ui.input} placeholder="owner@studio.com" />
        </label>
        <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Granting...">
          Grant owner workspace access
        </SubmitButton>
        {sp.owner_success === "granted" ? <p className={ui.success}>Owner access granted.</p> : null}
        {sp.owner_grant_updated === "1" ? <p className={ui.success}>Grant status updated.</p> : null}
        {errorMsg ? <p className={ui.error}>{errorMsg}</p> : null}
      </form>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Granted owners</h2>
        {rows.length === 0 ? (
          <p className={ui.muted}>No platform owner grants yet.</p>
        ) : (
          <div className={`${ui.card} overflow-x-auto`}>
            <p className={`mb-3 text-xs ${ui.muted}`}>Disable revokes the platform workspace gate for that user until you enable again. Existing studios are unchanged.</p>
            <table className="min-w-[520px] w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500 dark:border-stone-800">
                  <th className="pb-2 pr-3 font-medium">Email</th>
                  <th className="pb-2 pr-3 font-medium">Granted</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => {
                  const u = g.users;
                  const email = (Array.isArray(u) ? u[0]?.email : u?.email) ?? g.user_id;
                  const granted = new Date(g.created_at);
                  const grantedLabel = Number.isNaN(granted.getTime())
                    ? g.created_at
                    : granted.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      });
                  return (
                    <tr key={g.user_id} className="border-t border-stone-200/80 dark:border-stone-800/80">
                      <td className="py-2.5 pr-3 align-middle">{email}</td>
                      <td className="py-2.5 pr-3 align-middle text-stone-600 dark:text-stone-400">{grantedLabel}</td>
                      <td className="py-2.5 pr-3 align-middle">
                        <span
                          className={
                            g.is_active
                              ? "rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                              : "rounded-md bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                          }
                        >
                          {g.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="py-2.5 align-middle">
                        <form action={setPlatformOwnerGrantActive} className="inline">
                          <input type="hidden" name="user_id" value={g.user_id} />
                          <input type="hidden" name="is_active" value={g.is_active ? "false" : "true"} />
                          <SubmitButton
                            className={g.is_active ? `${ui.btnSecondarySm}` : `${ui.btnPrimary} text-xs px-3 py-1.5`}
                            pendingText="Saving..."
                          >
                            {g.is_active ? "Disable" : "Enable"}
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
