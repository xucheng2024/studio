import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { StudioMediaWarmup } from "@/components/StudioMediaWarmup";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { QuickEventBookPanel } from "@/components/QuickEventBookPanel";
import { getCachedEventShareContext } from "@/lib/cachedSharePages";
import { studioEventPath } from "@/lib/public-paths";
import { buildEventShareMetadata } from "@/lib/publicShareOg";
import { getVideoPreview } from "@/lib/videoPreview";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string; eventSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug, eventSlug } = await params;
  return buildEventShareMetadata(studioSlug, eventSlug);
}

export default async function PublicEventPage({ params }: Props) {
  const { studioSlug: rawStudio, eventSlug: rawEvent } = await params;
  const ctx = await getCachedEventShareContext(rawStudio ?? "", rawEvent ?? "");
  if (!ctx) notFound();
  const { studio, event } = ctx;

  const paymentReady = Boolean((studio as { hitpay_enabled?: boolean | null }).hitpay_enabled);
  const ended = new Date(String(event.end_time)).getTime() < new Date().getTime();
  const coverSrc = (event as { image_url?: string | null }).image_url ?? null;
  const videoUrl = (event as { video_url?: string | null }).video_url ?? null;
  const eventCurrency = String((event as { currency?: string | null }).currency ?? "SGD").toUpperCase();
  const videoPreview = getVideoPreview(videoUrl ?? "");
  const sharePath = studioEventPath(studio.public_slug ?? rawStudio, event.share_slug ?? rawEvent);
  const warmupMediaUrls = [coverSrc, videoPreview.thumbnailUrl]
    .map((url) => String(url ?? "").trim())
    .filter(Boolean);

  return (
    <main className={ui.page}>
      <StudioMediaWarmup urls={warmupMediaUrls} />
      {videoPreview.embedUrl || (videoUrl && videoUrl.trim()) ? (
        <div className="mb-6">
          <div className="relative">
            <PublicVideoCover
              title={event.title}
              coverUrl={coverSrc ?? videoPreview.thumbnailUrl ?? null}
              embedUrl={videoPreview.embedUrl}
              fallbackUrl={videoUrl?.trim() || null}
            />
            <div className="absolute bottom-4 right-4 z-20">
              <SessionShareLinkButton
                sharePath={sharePath}
                title={`${event.title} · ${studio.name}`}
                text={`Check out this event: ${event.title}`}
              />
            </div>
          </div>
        </div>
      ) : (
        <ShareCoverImage
          src={coverSrc}
          alt={event.title}
          sharePath={sharePath}
          shareTitle={event.title}
          shareText={`Book ${event.title} at ${studio.name}`}
        />
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0">
          <p className={ui.badge}>Shared event</p>
          <h1 className={`${ui.h1} mt-3`}>{event.title}</h1>
          <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600 dark:text-stone-300">
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              {new Date(String(event.start_time)).toLocaleString("en-SG", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Singapore" })}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              Ends {new Date(String(event.end_time)).toLocaleString("en-SG", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Singapore" })}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
              {Number(event.spots_left ?? 0)} / {Number(event.capacity ?? 0)} spots left
            </span>
            {(event as { address?: string | null }).address?.trim() ? (
              <span className="flex items-start gap-1.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs dark:bg-teal-900/40 dark:text-teal-300">✓</span>
                <span className="min-w-0">
                  <span className="block">{String((event as { address: string }).address)}</span>
                  {(event as { address_details?: string | null }).address_details?.trim() ? (
                    <span className="block text-xs text-stone-500 dark:text-stone-400">
                      {String((event as { address_details: string }).address_details)}
                    </span>
                  ) : null}
                </span>
              </span>
            ) : null}
          </div>

          {Array.isArray(event.tags) && event.tags.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {Array.from(new Map(event.tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values())
                .filter(Boolean)
                .map((tag) => (
                  <span key={tag.toLowerCase()} className={ui.badgeNeutral}>
                    {tag}
                  </span>
                ))}
            </div>
          ) : null}

          {event.description ? (
            <p className="mt-5 whitespace-pre-wrap leading-relaxed text-stone-700 dark:text-stone-300">
              {event.description}
            </p>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-8">
          <div className={`${ui.card} overflow-hidden sm:p-6`}>
            {ended ? (
              <>
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Event ended</p>
                <p className={`mt-1 text-sm ${ui.muted}`}>Bookings are closed for past events.</p>
                <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                  {eventCurrency} {Number(event.price ?? 0).toFixed(2)}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Book this event</p>
                <p className={`mt-1 text-sm ${paymentReady ? ui.muted : ui.error}`}>
                  {paymentReady ? "Secure checkout powered by HitPay." : "Online payment is not configured for this studio."}
                </p>
                <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                  {eventCurrency} {Number(event.price ?? 0).toFixed(2)}
                </p>

                <div className="mt-5">
                  <QuickEventBookPanel
                    slug={studio.public_slug ?? rawStudio}
                    eventId={event.id}
                    payLabel={`Pay ${eventCurrency} ${Number(event.price ?? 0).toFixed(2)}`}
                    disabled={!paymentReady}
                    defaultOpen
                    hideClose
                    embedded
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
