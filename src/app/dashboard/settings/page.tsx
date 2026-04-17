import Link from "next/link";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(
  path: string,
  selectedStudioId: string | null,
  selectedLocationId: string | null,
) {
  const p = new URLSearchParams();
  if (selectedStudioId) p.set("studio_id", selectedStudioId);
  if (selectedLocationId) p.set("location_id", selectedLocationId);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

export default async function DashboardSettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const isSuperAdmin = isSuperAdminEmail(user.email);

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const role = bestRole(ctx);
  if (!["owner", "manager"].includes(role) && !isSuperAdmin) {
    return <p className={ui.muted}>You do not have settings access.</p>;
  }
  if (studioIds.length === 0 && !isSuperAdmin) return <p className={ui.muted}>Create a studio first.</p>;
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio from the sidebar to continue.</p>;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className={ui.h1}>Settings</h1>
        <p className={ui.muted}>Studio-level configuration and admin tools.</p>
      </div>
      <div className={`${ui.card} grid gap-3 md:grid-cols-2`}>
        <Link href={scopedHref("/dashboard/overview", selectedStudioId, selectedLocationId)} className={ui.btnSecondary}>
          Studio profile
        </Link>
        <Link href={scopedHref("/dashboard/settings/payments", selectedStudioId, selectedLocationId)} className={ui.btnSecondary}>
          Payment settings
        </Link>
        {role === "owner" ? (
          <Link
            href={scopedHref("/dashboard/settings/staff-invites", selectedStudioId, selectedLocationId)}
            className={ui.btnSecondary}
          >
            Staff & roles
          </Link>
        ) : null}
        <Link href={scopedHref("/dashboard/qr", selectedStudioId, selectedLocationId)} className={ui.btnSecondary}>
          QR / share link
        </Link>
        {isSuperAdmin ? (
          <Link href="/dashboard/settings/owners" className={ui.btnSecondary}>
            Platform owner access
          </Link>
        ) : null}
      </div>
      {role !== "owner" ? (
        <p className={`text-sm ${ui.muted}`}>
          Manager view: owner-only settings may be visible as read-only depending on page rules.
        </p>
      ) : null}
    </div>
  );
}
