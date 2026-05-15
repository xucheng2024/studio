import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { StudioMediaWarmup } from "@/components/StudioMediaWarmup";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { getCachedServiceShareContext } from "@/lib/cachedSharePages";
import { studioServicePath, studioServicesPath } from "@/lib/public-paths";
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
  const sharePath = studioServicePath(studio.public_slug ?? rawStudio, serviceSlugPath);
  const warmupMediaUrls = [service.cover_image_url, videoPreview.thumbnailUrl]
    .map((url) => String(url ?? "").trim())
    .filter(Boolean);
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
      <div className="mb-4">
        <StudioPublicBackNav href={studioServicesPath(studio.public_slug ?? rawStudio)}>Back to services</StudioPublicBackNav>
      </div>
      <StudioMediaWarmup urls={warmupMediaUrls} />
      {videoPreview.embedUrl || service.video_url?.trim() ? (
        <div className="mb-6">
          <PublicVideoCover
            title={service.title}
            coverUrl={service.cover_image_url ?? videoPreview.thumbnailUrl ?? null}
            embedUrl={videoPreview.embedUrl}
            fallbackUrl={service.video_url?.trim() || null}
            priority
          />
        </div>
      ) : (
        <ShareCoverImage
          src={service.cover_image_url}
          alt={service.title}
          sharePath={sharePath}
          shareTitle={service.title}
          shareText={`${service.title} · ${studio.name}`}
        />
      )}

      <div className="max-w-2xl">
        <p className={ui.badge}>Service</p>
        <h1 className={`${ui.h1} mt-3`}>{service.title}</h1>
        <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>
        {service.price != null && Number(service.price) > 0 ? (
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

        <div className="mt-8 flex flex-wrap gap-3">
          {enquiryLink ? (
            <a href={enquiryLink} target="_blank" rel="noreferrer" className={ui.btnPrimary}>
              <MessageCircle size={16} />
              Enquire now
            </a>
          ) : null}
        </div>
      </div>
    </main>
  );
}
