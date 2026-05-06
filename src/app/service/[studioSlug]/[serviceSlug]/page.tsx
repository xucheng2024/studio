import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle, PlayCircle } from "lucide-react";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { getCachedServiceShareContext } from "@/lib/cachedSharePages";
import { buildServiceShareMetadata } from "@/lib/publicShareOg";
import { studioWhatsappLink } from "@/lib/publicStudio";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = { params: Promise<{ studioSlug: string; serviceSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, serviceSlug } = await params;
  return buildServiceShareMetadata(studioSlug, serviceSlug);
}

export default async function PublicServicePage({ params }: Props) {
  const { studioSlug: rawStudio, serviceSlug: rawService } = await params;
  const ctx = await getCachedServiceShareContext(rawStudio ?? "", rawService ?? "");
  if (!ctx) notFound();

  const { studio, service } = ctx;
  const videoPreview = getVideoPreview(service.video_url);
  const serviceSlugPath = service.share_slug;
  const sharePath = `/service/${studio.public_slug ?? rawStudio}/${serviceSlugPath}`;
  const waLink = studioWhatsappLink({
    enabled: studio.whatsapp_enabled,
    numberE164: studio.whatsapp_number_e164,
    prefillText: studio.whatsapp_prefill_text,
  });
  const enquiryLink = waLink
    ? (() => {
        try {
          const url = new URL(waLink);
          const current = url.searchParams.get("text") ?? "Hi, I’m interested in your services.";
          url.searchParams.set("text", `${current}\n\nService: ${service.title}`);
          return url.toString();
        } catch {
          return waLink;
        }
      })()
    : null;

  return (
    <main className={ui.page}>
      <ShareCoverImage
        src={service.cover_image_url}
        alt={service.title}
        sharePath={sharePath}
        shareTitle={service.title}
        shareText={`${service.title} · ${studio.name}`}
      />

      <div className="max-w-2xl">
        <p className={ui.badge}>Shared service</p>
        <h1 className={`${ui.h1} mt-3`}>{service.title}</h1>
        <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
        {service.price != null ? (
          <p className="mt-3 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {service.currency} {Number(service.price).toFixed(2)}
          </p>
        ) : null}
        {Array.isArray(service.tags) && service.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from(new Map(service.tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values())
              .filter(Boolean)
              .map((tag) => (
                <span key={tag.toLowerCase()} className={ui.badgeNeutral}>
                  {tag}
                </span>
              ))}
          </div>
        ) : null}
        {service.summary ? <p className={`mt-4 ${ui.lead}`}>{service.summary}</p> : null}
        {service.description ? (
          <p className="mt-4 whitespace-pre-wrap leading-relaxed text-stone-700 dark:text-stone-300">
            {service.description}
          </p>
        ) : null}

        {service.video_url ? (
          <div className="mt-8">
            {videoPreview.embedUrl ? (
              <div className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-700">
                <iframe
                  src={videoPreview.embedUrl}
                  title={`${service.title} video`}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : (
              <a href={service.video_url} target="_blank" rel="noreferrer" className={`${ui.link} gap-1.5`}>
                <PlayCircle size={15} />
                Watch service video
              </a>
            )}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          {enquiryLink ? (
            <a href={enquiryLink} target="_blank" rel="noreferrer" className={ui.btnPrimary}>
              <MessageCircle size={16} />
              Enquire now
            </a>
          ) : null}
          <Link href={`/${studio.public_slug ?? rawStudio}#services`} className={ui.btnSecondary}>
            Back to services
          </Link>
        </div>
      </div>
    </main>
  );
}
