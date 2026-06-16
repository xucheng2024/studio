import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareCoverImage } from "@/components/ShareCoverImage";
import { StudioMediaWarmup } from "@/components/StudioMediaWarmup";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { QuickEventBookPanel } from "@/components/QuickEventBookPanel";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { getCachedEventShareContext } from "@/lib/cachedSharePages";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { studioEventPath, studioEventsPath } from "@/lib/public-paths";
import { buildEventShareMetadata } from "@/lib/publicShareOg";
import { getVideoPreview } from "@/lib/videoPreview";
import { eventVenueForPublicBlock, PublicVenueBlock } from "@/components/PublicVenueBlock";
import { sanitizeEventExternalBookingUrl } from "@/lib/eventBookingUrl";
import { formatPriceOrFree, isZeroAmount } from "@/lib/priceDisplay";
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

  const isFreeEvent = isZeroAmount(event.price);
  const paymentReady = isFreeEvent || Boolean((studio as { hitpay_enabled?: boolean | null }).hitpay_enabled);
  const ended = new Date(String(event.end_time)).getTime() < new Date().getTime();
  const coverSrc = (event as { image_url?: string | null }).image_url ?? null;
  const videoUrl = (event as { video_url?: string | null }).video_url ?? null;
  const eventCurrency = STUDIO_CURRENCY;
  const hasEventPrice = event.price != null && Number(event.price) >= 0;
  const videoPreview = getVideoPreview(videoUrl ?? "");
  const sharePath = studioEventPath(studio.public_slug ?? rawStudio, event.share_slug ?? rawEvent);
  const warmupMediaUrls = [coverSrc, videoPreview.thumbnailUrl]
    .map((url) => String(url ?? "").trim())
    .filter(Boolean);

  const { address: venueAddress, addressDetails: venueAddressDetails } = eventVenueForPublicBlock(
    event as {
      address?: string | null;
      address_details?: string | null;
      locations?: { name?: string | null; address?: string | null } | { name?: string | null; address?: string | null }[] | null;
    },
  );

  const externalBookUrl = sanitizeEventExternalBookingUrl(
    (event as { external_booking_url?: string | null }).external_booking_url,
  );
  const useExternalBooking = Boolean(externalBookUrl && !ended);

  return (
    <main className={ui.page}>
      <StudioMediaWarmup urls={warmupMediaUrls} />
      <div className="mb-4">
        <StudioPublicBackNav href={studioEventsPath(studio.public_slug ?? rawStudio)}>Back to events</StudioPublicBackNav>
      </div>
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
          <p className={ui.badge}>Event</p>
          <h1 className={`${ui.h1} mt-3`}>{event.title}</h1>
          <p className={`mt-2 ${ui.lead}`}>{studio.name}</p>

          <div className="mt-4 flex flex-col gap-4 text-sm text-stone-600 dark:text-stone-300">
            {/* When */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">When</p>
              <div className="flex flex-col gap-1">
                <span>
                  {new Date(String(event.start_time)).toLocaleString("en-SG", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Singapore" })}
                </span>
                <span className="text-stone-500 dark:text-stone-400">
                  Ends {new Date(String(event.end_time)).toLocaleString("en-SG", { timeStyle: "short", timeZone: "Asia/Singapore" })}
                </span>
              </div>
            </div>

            <PublicVenueBlock address={venueAddress} addressDetails={venueAddressDetails} />

            {/* Availability */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Availability</p>
              <span className={Number(event.spots_left ?? 0) === 0 ? "font-semibold text-red-600 dark:text-red-400" : Number(event.spots_left ?? 0) <= 5 ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>
                {Number(event.spots_left ?? 0)} / {Number(event.capacity ?? 0)} spots left
              </span>
            </div>
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
                {hasEventPrice ? (
                  <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                    {formatPriceOrFree(eventCurrency, Number(event.price))}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Book this event</p>
                <p className={`mt-1 text-sm ${useExternalBooking ? ui.muted : paymentReady ? ui.muted : ui.error}`}>
                  {useExternalBooking
                    ? "You will complete booking on an external site (opens in a new tab)."
                    : isFreeEvent
                      ? "No payment required. Your booking will be confirmed automatically."
                      : paymentReady
                      ? "Secure checkout powered by HitPay."
                      : "Online payment is not configured for this studio."}
                </p>
                {hasEventPrice ? (
                  <p className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                    {formatPriceOrFree(eventCurrency, Number(event.price))}
                    {!isFreeEvent ? <span className="ml-2 text-base font-medium text-stone-500 dark:text-stone-400">/ ticket</span> : null}
                  </p>
                ) : (
                  <p className={`mt-4 text-sm ${ui.muted}`}>Price unavailable</p>
                )}

                <div className="mt-5">
                  {useExternalBooking && externalBookUrl ? (
                    <a
                      href={externalBookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${ui.btnPrimary} inline-flex w-full items-center justify-center py-3 text-base font-semibold`}
                    >
                      Book now
                    </a>
                  ) : null}
                  {!useExternalBooking && hasEventPrice ? (
                    <QuickEventBookPanel
                      slug={studio.public_slug ?? rawStudio}
                      eventId={event.id}
                      payLabel={isFreeEvent ? "Book free" : `Pay ${eventCurrency} ${Number(event.price).toFixed(2)}`}
                      disabled={!paymentReady}
                      defaultOpen
                      hideClose
                      embedded
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
