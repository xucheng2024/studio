import { renderProfilePage } from "@/app/me/_shared/profile-page";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyProfilePage({ params }: Props) {
  const { studioSlug } = await params;
  return renderProfilePage({ studioSlug });
}
