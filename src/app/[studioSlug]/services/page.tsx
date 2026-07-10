import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { buildStudioListMetadata } from "@/lib/publicListMetadata";
import { isReservedPublicSlug, studioWhatsappLink } from "@/lib/publicStudio";
import { studioHomePath, studioServicePath, studioServicesPath } from "@/lib/public-paths";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = { params: Promise<{ studioSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug } = await params;
  return buildStudioListMetadata({
    studioSlugRaw: studioSlug,
    title: "Services",
    description: "Browse all available services and pricing.",
    path: studioServicesPath(studioSlug),
  });
}

export default async function PublicServicesPage({ params }: Props) {
  const { studioSlug: rawSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawSlug);
  if (!studioSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, public_services_title, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text, contract_status, hitpay_enabled")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const { data: services } = await admin
    .from("studio_services")
    .select("id, title, summary, description, price, cover_image_url, video_url, tags, share_slug, sort_order, enable_enquiry, enable_payment")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const waLink = studioWhatsappLink({
    enabled: studio.whatsapp_enabled,
    numberE164: studio.whatsapp_number_e164,
    prefillText: studio.whatsapp_prefill_text,
  });
  const buildServiceWaLink = (serviceTitle: string) => {
    if (!waLink) return null;
    try {
      const url = new URL(waLink);
      const current = url.searchParams.get("text") ?? "Hi, I’m interested in your services.";
      url.searchParams.set("text", `${current}\n\nService: ${serviceTitle}`);
      return url.toString();
    } catch {
      return waLink;
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={`${studioHomePath(studio.public_slug)}#services`}>Back to studio</StudioPublicBackNav>
      <div className="mt-4 max-w-2xl">
        <h1 className={ui.h1}>{studio.public_services_title?.trim() || "Services"}</h1>
        <p className={`mt-1 text-sm ${ui.muted}`}>
          Choose a service to view details, pay online when available, or send an enquiry.
        </p>
      </div>
      <div className="mt-5 grid gap-4">
        {(services ?? []).map((svc) => {
          const href = studioServicePath(studio.public_slug, svc.share_slug);
          const serviceCurrency = STUDIO_CURRENCY;
          const preview = getVideoPreview((svc as { video_url?: string | null }).video_url ?? "");
          const cover = svc.cover_image_url ?? preview.thumbnailUrl ?? null;
          const serviceWaLink = buildServiceWaLink(svc.title);
          const paymentEnabled = Boolean((svc as { enable_payment?: boolean | null }).enable_payment);
          const enquiryEnabled = Boolean((svc as { enable_enquiry?: boolean | null }).enable_enquiry);
          const paymentReady = Number(svc.price ?? 0) === 0 || Boolean(studio.hitpay_enabled);
          const tags = Array.isArray((svc as { tags?: string[] | null }).tags) ? (svc as { tags: string[] }).tags : [];
          return (
            <article key={svc.id} className={ui.card}>
              <div className="grid gap-4 sm:grid-cols-[minmax(220px,42%)_1fr]">
                <Link href={href} className="block">
                  {cover ? (
                    <Image src={cover} alt={svc.title} width={1200} height={675} className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800" />
                  ) : (
                    <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                  )}
                </Link>
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                      <Link href={href} className="transition hover:text-teal-700 dark:hover:text-teal-400">{svc.title}</Link>
                    </h2>
                    {svc.price != null && Number(svc.price) > 0 ? <span className="shrink-0 text-lg font-bold tabular-nums text-stone-900 dark:text-stone-50">{serviceCurrency} {Number(svc.price).toFixed(2)}</span> : null}
                  </div>
                  {svc.summary ? <p className={`mt-2 text-sm ${ui.muted}`}>{svc.summary}</p> : null}
                  {svc.description ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">{svc.description}</p> : null}
                  {tags.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {tags.slice(0, 5).map((tag) => <span key={`${svc.id}-${tag}`} className={ui.badgeNeutral}>{tag}</span>)}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    {paymentEnabled ? (
                      <Link href={href} className={`${ui.btnPrimarySm} w-full sm:w-auto`}>
                        {paymentReady && svc.price != null && Number(svc.price) > 0 ? `Pay ${serviceCurrency} ${Number(svc.price).toFixed(2)}` : "Pay now"}
                      </Link>
                    ) : null}
                    {enquiryEnabled && serviceWaLink ? <a href={serviceWaLink} target="_blank" rel="noreferrer" className={`${paymentEnabled ? ui.btnSecondarySm : ui.btnPrimarySm} w-full sm:w-auto`}>Enquire now</a> : null}
                    <SessionShareLinkButton sharePath={href} title={`${svc.title} · ${studio.name}`} text={`Check out this service: ${svc.title}`} />
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!services?.length ? (
        <div className={`mt-6 ${ui.emptyState}`}>
          <p className={`text-sm ${ui.muted}`}>No services available right now.</p>
        </div>
      ) : null}
    </main>
  );
}
