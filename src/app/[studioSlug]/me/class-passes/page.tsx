import { renderClassPassesPage } from "@/app/me/_shared/class-passes-page";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyClassPassesPage({ params }: Props) {
  const { studioSlug } = await params;
  return renderClassPassesPage({ studioSlug });
}
