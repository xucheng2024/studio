import { grantOwnerAccessByEmail } from "@/app/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ owner_error?: string; owner_success?: string }> };

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

  const errorMsg =
    sp.owner_error === "email_not_registered"
      ? "Email has no account yet. Ask user to sign in once first."
      : sp.owner_error === "save_failed"
        ? "Could not grant owner access."
        : sp.owner_error === "invalid_email"
          ? "Please enter a valid email."
          : sp.owner_error === "forbidden"
            ? "Forbidden."
            : null;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Platform owner access</h1>
        <p className={ui.muted}>Super admin only. Grant owner workspace access by email.</p>
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
        {errorMsg ? <p className={ui.error}>{errorMsg}</p> : null}
      </form>
    </div>
  );
}

