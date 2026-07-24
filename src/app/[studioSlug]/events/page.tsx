import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { buildStudioListMetadata } from "@/lib/publicListMetadata";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioEventPath, studioEventsPath, studioHomePath } from "@/lib/public-paths";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = {
  params: Promise<{ studioSlug: string }>;
  searchParams?: Promise<{ tab?: string }>;
};

type EventItem = {
  id: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  start_time: string;
  end_time: string;
  capacity: number | null;
  spots_left: number | null;
  price: number | null;
  share_slug: string | null;
  image_url: string | null;
  video_url: string | null;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { studioSlug } = await params;
  return buildStudioListMetadata({
    studioSlugRaw: studioSlug,
    title: "Events",
    description: "See upcoming and past events with schedules and prices.",
    path: studioEventsPath(studioSlug),
  });
}


function EventCard({
  event,
  studio,
  currentTimeMs,
}: {
  event: EventItem;
  studio: { name: string; public_slug: string };
  currentTimeMs: number;
}) {
  const start = new Date(String(event.start_time));
  const end = new Date(String(event.end_time));
  const isEnded = end.getTime() < currentTimeMs;
  const dateLabel = start.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Singapore" });
  const timeLabel = start.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
  const endLabel = end.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
  const href = event.share_slug ? studioEventPath(studio.public_slug, event.share_slug) : studioHomePath(studio.public_slug);
  const preview = getVideoPreview(String(event.video_url ?? ""));
  const cover = event.image_url ?? preview.thumbnailUrl ?? null;
  const spotsLeft = Number(event.spots_left ?? 0);
  const capacity = Number(event.capacity ?? 0);
  const spotsText = spotsLeft === 0
    ? capacity > 0 ? `0/${capacity} spots left` : "Full"
    : capacity > 0 ? `${spotsLeft}/${capacity} spots left` : `${spotsLeft} spots left`;
  const tags = Array.isArray(event.tags) ? event.tags : [];
  const pastEventBadgeClass =
    "inline-flex items-center rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200";

  return (
    <article className={`${ui.card} transition-shadow hover:border-teal-200 hover:shadow-md dark:hover:border-teal-800`}>
      <Link href={href} className="block">
        <div className="grid gap-4 sm:grid-cols-[minmax(220px,42%)_1fr]">
          <div className="relative">
            {cover ? (
              <Image src={cover} alt={String(event.title ?? "Event")} width={1200} height={675} className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800" />
            ) : (
              <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
            )}
            {event.price != null && Number(event.price) >= 0 ? (
              <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                {Number(event.price) === 0 ? "Free" : `${STUDIO_CURRENCY} ${Number(event.price).toFixed(2)}`}
              </span>
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {isEnded ? <span className={pastEventBadgeClass}>Past event</span> : null}
              <p className={`text-sm ${ui.muted}`}>{dateLabel} · {timeLabel}-{endLabel}</p>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">{String(event.title ?? "Event")}</h2>
            {event.description ? <p className="mt-2 line-clamp-3 text-sm text-stone-700 dark:text-stone-300">{String(event.description)}</p> : null}
            {tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.slice(0, 5).map((tag: string) => <span key={`${event.id}-${tag}`} className={ui.badgeNeutral}>{tag}</span>)}
              </div>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              {!isEnded ? <span className={`text-sm ${ui.muted}`}>{spotsText}</span> : null}
              <span className={`${isEnded ? ui.btnSecondarySm : ui.btnPrimarySm} w-full sm:w-auto`}>{isEnded ? "View event" : Number(event.price ?? 0) === 0 ? "Book free" : "Book now"}</span>
            </div>
          </div>
        </div>
      </Link>
      <div className="mt-3 flex justify-end">
        <SessionShareLinkButton sharePath={href} title={`${String(event.title ?? "Event")} · ${studio.name}`} text={`Check out this event: ${String(event.title ?? "Event")}`} />
      </div>
    </article>
  );
}

export default async function PublicEventsPage({ params, searchParams }: Props) {
  const { studioSlug: rawSlug } = await params;
  const { tab } = (await searchParams) ?? {};
  const requestedTab = tab === "past" || tab === "ended" ? "past" : tab === "upcoming" ? "upcoming" : null;
  const studioSlug = normalizeStudioSlug(rawSlug);
  if (!studioSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, public_events_title, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const nowIso = new Date().toISOString();
  const currentTimeMs = new Date(nowIso).getTime();
  const [{ data: upcoming }, { data: ended }] = await Promise.all([
    admin
      .from("events")
      .select("id, title, description, tags, start_time, end_time, capacity, spots_left, price, share_slug, image_url, video_url")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .gte("end_time", nowIso)
      .order("start_time", { ascending: true }),
    admin
      .from("events")
      .select("id, title, description, tags, start_time, end_time, capacity, spots_left, price, share_slug, image_url, video_url")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .lt("end_time", nowIso)
      .order("start_time", { ascending: false }),
  ]);
  const upcomingItems = upcoming ?? [];
  const endedItems = ended ?? [];
  const activeTab = requestedTab ?? (upcomingItems.length === 0 && endedItems.length > 0 ? "past" : "upcoming");
  const items = activeTab === "past" ? endedItems : upcomingItems;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={`${studioHomePath(studio.public_slug)}#events`}>Back to studio</StudioPublicBackNav>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className={ui.h1}>{studio.public_events_title?.trim() || "Events"}</h1>
        </div>
        <div className="flex gap-3 text-sm font-medium">
          <Link href={studioEventsPath(studio.public_slug)} className={activeTab === "upcoming" ? "text-teal-700 dark:text-teal-400" : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"}>Upcoming</Link>
          <Link href={studioEventsPath(studio.public_slug, "past")} className={activeTab === "past" ? "text-teal-700 dark:text-teal-400" : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"}>Past</Link>
        </div>
      </div>
      <div className="mt-5 grid gap-4">
        {items.length ? items.map((event) => <EventCard key={event.id} event={event} studio={studio} currentTimeMs={currentTimeMs} />) : (
          <div className={ui.emptyState}>
            <p className={`text-sm ${ui.muted}`}>{activeTab === "past" ? "No past events yet." : "No upcoming events yet."}</p>
            {activeTab === "upcoming" && endedItems.length > 0 ? (
              <Link href={studioEventsPath(studio.public_slug, "past")} className={ui.link}>
                View past events
              </Link>
            ) : null}
            {activeTab === "past" && upcomingItems.length > 0 ? (
              <Link href={studioEventsPath(studio.public_slug)} className={ui.link}>
                View upcoming events
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
