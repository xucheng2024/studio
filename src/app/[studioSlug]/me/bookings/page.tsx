import { renderBookingsPage } from "@/app/me/_shared/bookings-page";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyBookingsPage({ params }: Props) {
  const { studioSlug } = await params;
  return renderBookingsPage({ studioSlug });
}
