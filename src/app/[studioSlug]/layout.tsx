import type { Metadata } from "next";
import { StudioPwaRegister } from "@/components/StudioPwaRegister";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  children: React.ReactNode;
  params: Promise<{ studioSlug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  if (!studioSlug || isReservedPublicSlug(studioSlug)) {
    return {};
  }

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("name, public_brand_name, public_logo_url, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();

  const appTitle =
    studio?.public_brand_name?.trim() ||
    studio?.name?.trim() ||
    "Studio";
  const appleIcon =
    studio?.contract_status !== "suspended" &&
    isTrustedCoverImageUrl(studio?.public_logo_url)
      ? studio?.public_logo_url
      : "/favicon.ico";

  return {
    manifest: `/pwa/${studioSlug}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: appTitle,
    },
    icons: {
      apple: appleIcon,
    },
  };
}

export default async function StudioPublicLayout({ children, params }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  return (
    <div className="min-h-dvh flex flex-col bg-white dark:bg-stone-950">
      {studioSlug && !isReservedPublicSlug(studioSlug) ? (
        <StudioPwaRegister studioSlug={studioSlug} />
      ) : null}
      {children}
    </div>
  );
}
