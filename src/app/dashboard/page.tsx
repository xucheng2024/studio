import { redirect } from "next/navigation";
import { getDashboardScope } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    date_from?: string;
    date_to?: string;
    status?: string;
    recon_status?: string;
    q?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const { studioIds } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const isOwnerProfile = profile?.role === "owner";

  const params = new URLSearchParams();
  if (sp.studio_id) params.set("studio_id", sp.studio_id);
  if (sp.location_id) params.set("location_id", sp.location_id);
  if (sp.date_from) params.set("date_from", sp.date_from);
  if (sp.date_to) params.set("date_to", sp.date_to);
  if (sp.status) params.set("status", sp.status);
  if (sp.recon_status) params.set("recon_status", sp.recon_status);
  if (sp.q) params.set("q", sp.q);
  const q = params.toString();
  if (studioIds.length === 0 && isOwnerProfile) {
    redirect(q ? `/dashboard/overview?${q}` : "/dashboard/overview");
  }
  redirect(q ? `/dashboard/operations?${q}` : "/dashboard/operations");
}
