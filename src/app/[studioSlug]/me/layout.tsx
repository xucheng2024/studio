import type { Metadata } from "next";
import { StudioMemberTabs } from "@/components/StudioMemberTabs";
import { normalizeStudioSlug } from "@/lib/slug";

type Props = {
  children: React.ReactNode;
  params: Promise<{ studioSlug: string }>;
};

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function StudioMemberLayout({ children, params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  return (
    <div className="min-h-screen bg-stone-50/70 dark:bg-stone-950">
      {studioSlug ? <StudioMemberTabs studioSlug={studioSlug} /> : null}
      {children}
    </div>
  );
}
