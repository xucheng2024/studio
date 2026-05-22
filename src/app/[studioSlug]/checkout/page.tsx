import type { Metadata } from "next";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ studioSlug: string }> };

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function StudioCheckoutIndexPage({ params }: Props) {
  const { studioSlug } = await params;
  redirect(`/${studioSlug}/classes`);
}
