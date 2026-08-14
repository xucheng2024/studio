import { renderAppointmentsPage } from "@/app/me/_shared/appointments-page";

type Props = {
  params: Promise<{ studioSlug: string }>;
  searchParams?: Promise<{
    ok?: string;
    error?: string;
  }>;
};

export default async function StudioMyAppointmentsPage({ params, searchParams }: Props) {
  const { studioSlug } = await params;
  const sp = (await searchParams) ?? {};
  return renderAppointmentsPage({ studioSlug }, {
    ok: typeof sp.ok === "string" ? sp.ok : undefined,
    error: typeof sp.error === "string" ? sp.error : undefined,
  });
}
