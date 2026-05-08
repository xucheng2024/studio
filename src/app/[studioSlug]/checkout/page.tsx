import { redirect } from "next/navigation";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function StudioCheckoutIndexPage({ params }: Props) {
  const { studioSlug } = await params;
  redirect(`/${studioSlug}/classes`);
}
