import type { Metadata } from "next";
import { StudioPwaRegister } from "@/components/StudioPwaRegister";
import { StudioPushOptIn } from "@/components/StudioPushOptIn";
import { StudioWhatsappFloatingButton } from "@/components/StudioWhatsappFloatingButton";
import { isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { isReservedPublicSlug, studioWhatsappLink } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

/** Studio public routes (home + lists) must not freeze session queries from build time; refresh periodically. */
export const revalidate = 60;

type Props = {
  children: React.ReactNode;
  params: Promise<{ studioSlug: string }>;
};

async function StudioWhatsappFab({ studioSlug }: { studioSlug: string }) {
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("contract_status, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;
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
  if (studioSlug && !isReservedPublicSlug(studioSlug)) {
    const admin = createAdminClient();
    await sweepExpiredPendingPayments(admin);
  }

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
