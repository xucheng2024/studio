import { DashboardAppLink } from "@/components/DashboardAppLink";
import { StudioFaqManager } from "@/components/dashboard/StudioFaqManager";
import { getDashboardScope } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = { searchParams: Promise<{ studio_id?: string; location_id?: string }> };

function scopedHref(path: string, studioId: string | null) {
  const p = new URLSearchParams();
  if (studioId) p.set("studio_id", studioId);
  return p.toString() ? `${path}?${p.toString()}` : path;
}

export default async function StudioFaqSettingsPage({ searchParams }: Props) {
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
  const isStudioOwner = ctx.isSuperAdmin || ctx.memberships.some(
    (m) => m.studio_id === studioId && m.role === "owner",
  );
  if (!isStudioOwner) {
    return <p className={ui.muted}>Only studio owners can manage public FAQs.</p>;
  }

  const admin = createAdminClient();
  const [{ data: studio }, { data: faqs }] = await Promise.all([
    admin.from("studios").select("id, name, public_slug").eq("id", studioId).maybeSingle(),
    admin
      .from("studio_faqs")
      .select("id, studio_id, question, answer, sort_order, created_at")
      .eq("studio_id", studioId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);
  if (!studio) return <p className={ui.muted}>Studio not found.</p>;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={ui.h1}>Public FAQs</h1>
          <p className={ui.muted}>Manage the FAQ accordion shown at the bottom of /{studio.public_slug}.</p>
        </div>
        <DashboardAppLink href={scopedHref("/dashboard/settings", selectedStudioId)} className={ui.btnSecondarySm}>
          Back to settings
        </DashboardAppLink>
      </div>

      <StudioFaqManager studioId={studio.id} initialFaqs={(faqs ?? []).map((faq) => ({
        id: faq.id,
        studio_id: faq.studio_id,
        question: faq.question,
        answer: faq.answer,
        sort_order: Number(faq.sort_order ?? 100),
        created_at: faq.created_at ?? null,
      }))} />
    </div>
  );
}
