import { renderAppointmentsPage } from "@/app/me/_shared/appointments-page";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function StudioMyAppointmentsPage({ params }: Props) {
  const { studioSlug } = await params;
  return renderAppointmentsPage({ studioSlug });
}
