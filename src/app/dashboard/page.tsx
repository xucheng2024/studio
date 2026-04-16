import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<{ location_id?: string; studio_id?: string; date?: string; q?: string }>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.studio_id) params.set("studio_id", sp.studio_id);
  if (sp.location_id) params.set("location_id", sp.location_id);
  if (sp.date) params.set("date", sp.date);
  if (sp.q) params.set("q", sp.q);
  const q = params.toString();
  redirect(q ? `/dashboard/operations?${q}` : "/dashboard/operations");
}
