import type { Metadata } from "next";
import { StudioPwaRegister } from "@/components/StudioPwaRegister";
import { StudioPushOptIn } from "@/components/StudioPushOptIn";
import { StudioWhatsappFloatingButton } from "@/components/StudioWhatsappFloatingButton";
import { getCachedStudioPublicMeta } from "@/lib/cachedPublicStudio";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { isReservedPublicSlug, studioWhatsappLink } from "@/lib/publicStudio";
import { getRequestOriginForOg } from "@/lib/requestOrigin";
import { normalizeStudioSlug } from "@/lib/slug";
import { headers } from "next/headers";

/** Studio public routes (home + lists) must not freeze session queries from build time; refresh periodically. */
export const revalidate = 60;

type Props = {
  children: React.ReactNode;
  params: Promise<{ studioSlug: string }>;
};

async function StudioWhatsappFab({ studioSlug }: { studioSlug: string }) {
  const studio = await getCachedStudioPublicMeta(studioSlug);
  if (!studio) return null;
  const href = studioWhatsappLink({
    enabled: studio.whatsapp_enabled,
    numberE164: studio.whatsapp_number_e164,
    prefillText: studio.whatsapp_prefill_text,
  });
  return <StudioWhatsappFloatingButton href={href} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug: rawStudioSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  if (!studioSlug || isReservedPublicSlug(studioSlug)) {
    return {};
  }

  const studio = await getCachedStudioPublicMeta(studioSlug);

  const appTitle =
    studio?.public_brand_name?.trim() ||
    studio?.name?.trim() ||
    "Studio";
  const appleIcon =
    studio?.contract_status !== "suspended" &&
    isTrustedCoverImageUrl(studio?.public_logo_url)
      ? `/pwa/${studioSlug}/icons/180`
      : "/icons/apple-touch-icon.png";

  const h = await headers();
  const onCustomDomain = Boolean(h.get("x-studio-slug")?.trim());
  let metadataBase: URL | undefined;
  if (onCustomDomain) {
    const origin = await getRequestOriginForOg();
    try {
      metadataBase = origin ? new URL(origin) : undefined;
    } catch {
      metadataBase = undefined;
    }
  }

  return {
    ...(metadataBase ? { metadataBase } : {}),
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
        <>
          <StudioPwaRegister studioSlug={studioSlug} />
          <StudioPushOptIn studioSlug={studioSlug} />
          <StudioWhatsappFab studioSlug={studioSlug} />
        </>
      ) : null}
      {children}
    </div>
  );
}
