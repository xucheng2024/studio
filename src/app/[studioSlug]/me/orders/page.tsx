import { renderOrdersPage } from "@/app/me/_shared/orders-page";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyOrdersPage({ params }: Props) {
  const { studioSlug } = await params;
  return renderOrdersPage({ studioSlug });
}
