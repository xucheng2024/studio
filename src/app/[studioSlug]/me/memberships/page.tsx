import { renderMembershipsPage } from "@/app/me/_shared/memberships-page";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function MyMembershipsPage({ params }: Props) {
  const { studioSlug } = await params;
  return renderMembershipsPage({ studioSlug });
}
