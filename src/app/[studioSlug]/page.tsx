import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { MessageCircle, PlayCircle } from "lucide-react";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { isReservedPublicSlug, studioWhatsappLink } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = { params: Promise<{ studioSlug: string }> };

const getPublicStudioData = cache(async (studioSlugRaw: string) => {
  const slug = normalizeStudioSlug(studioSlugRaw ?? "");
  if (!slug || isReservedPublicSlug(slug)) return null;
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status, public_intro, public_cover_image_url, public_video_url, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: services } = await admin
    .from("studio_services")
    .select("id, title, summary, description, price, currency, cover_image_url, video_url, sort_order")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const nowIso = new Date().toISOString();
  const { data: classes } = await admin
    .from("class_sessions")
    .select("id, start_time, spots_left, guest_price, classes!inner(title, share_slug, image_url, studio_id, is_active)")
    .eq("classes.studio_id", studio.id)
    .eq("classes.is_active", true)
    .eq("status", "scheduled")
    .gte("start_time", nowIso)
    .order("start_time", { ascending: true })
    .limit(8);

  return {
    studio,
    services: services ?? [],
    classes: classes ?? [],
  };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug } = await params;
  const data = await getPublicStudioData(studioSlug);
  if (!data) return { title: "Studio" };
  const { studio } = data;
  const intro = (studio.public_intro ?? "").trim();
  const description = intro || `Explore services at ${studio.name}.`;
  const cover = studio.public_cover_image_url && isTrustedCoverImageUrl(studio.public_cover_image_url)
    ? studio.public_cover_image_url
    : absolutePlaceholderCoverUrl();
  return {
    title: `${studio.name} · Studio`,
    description,
    openGraph: {
      title: studio.name,
      description,
      type: "website",
      images: [{ url: cover, width: 1200, height: 675, alt: studio.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: studio.name,
      description,
      images: [cover],
    },
  };
}

export default async function StudioPublicLandingPage({ params }: Props) {
  const { studioSlug } = await params;
  const data = await getPublicStudioData(studioSlug);
  if (!data) notFound();
  const { studio, services, classes } = data;

  const cover = studio.public_cover_image_url && isTrustedCoverImageUrl(studio.public_cover_image_url)
    ? studio.public_cover_image_url
    : null;
  const waLink = studioWhatsappLink({
    enabled: studio.whatsapp_enabled,
    numberE164: studio.whatsapp_number_e164,
    prefillText: studio.whatsapp_prefill_text,
  });
  const studioVideoPreview = getVideoPreview(studio.public_video_url);

  return (
    <main className={ui.page}>
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={studio.name} className="aspect-video w-full rounded-2xl border border-stone-200 object-cover shadow-sm dark:border-stone-800" />
        ) : (
          <div className="aspect-video w-full rounded-2xl bg-linear-to-br from-stone-100 to-stone-200 dark:from-stone-800 dark:to-stone-900" />
        )}
        <div className={ui.card}>
          <div className="grid gap-4 sm:grid-cols-[140px_1fr] sm:items-start">
            <div className="w-full">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt={`${studio.name} portrait`}
                  className="aspect-square w-full rounded-xl border border-stone-200 object-cover dark:border-stone-700"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-square w-full rounded-xl bg-stone-100 dark:bg-stone-900" />
              )}
            </div>
            <div>
              {studio.public_intro?.trim() ? (
                <details className="group">
                  <summary className={`cursor-pointer list-none ${ui.lead}`}>
                    <span className="line-clamp-4 whitespace-pre-wrap">
                      {studio.public_intro.trim()}
                    </span>
                    <span className="mt-2 inline-flex text-sm font-medium text-teal-700 group-open:hidden dark:text-teal-400">
                      Read more
                    </span>
                    <span className="mt-2 hidden text-sm font-medium text-teal-700 group-open:inline-flex dark:text-teal-400">
                      Show less
                    </span>
                  </summary>
                  <p className={`mt-2 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300`}>
                    {studio.public_intro.trim()}
                  </p>
                </details>
              ) : (
                <p className={ui.lead}>Welcome to our studio. Explore services and get in touch.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {studio.public_video_url ? (
        <section className="mx-auto mt-10 w-full max-w-5xl">
          <div className={ui.card}>
            {studioVideoPreview.embedUrl ? (
              <div className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
                <iframe
                  src={studioVideoPreview.embedUrl}
                  title="Studio promo video"
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : (
              <a href={studio.public_video_url} target="_blank" rel="noreferrer" className={`${ui.link} gap-1.5`}>
                <PlayCircle size={15} />
                Watch studio video
              </a>
            )}
          </div>
        </section>
      ) : null}

      <section className="mx-auto mt-10 w-full max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={ui.h2}>Services</h2>
        </div>
        {services.length === 0 ? (
          <div className={`mt-4 ${ui.emptyState}`}>
            <p className={ui.muted}>No services published yet.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            {services.map((svc) => {
              const serviceVideoPreview = getVideoPreview(svc.video_url);
              return (
                <article key={svc.id} className={ui.card}>
                  <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                    <div>
                      {svc.cover_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={svc.cover_image_url} alt={svc.title} className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800" />
                      ) : (
                        <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{svc.title}</h3>
                        <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                          {svc.currency} {Number(svc.price ?? 0).toFixed(2)}
                        </span>
                      </div>
                      {svc.summary ? <p className={`mt-2 text-sm ${ui.muted}`}>{svc.summary}</p> : null}
                      {svc.description ? (
                        <p className="mt-3 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">{svc.description}</p>
                      ) : null}
                      {svc.video_url ? (
                        <div className="mt-3">
                          {serviceVideoPreview.embedUrl ? (
                            <div className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
                              <iframe
                                src={serviceVideoPreview.embedUrl}
                                title={`${svc.title} video`}
                                className="aspect-video w-full"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                              />
                            </div>
                          ) : (
                            <a
                              href={svc.video_url}
                              target="_blank"
                              rel="noreferrer"
                              className="group block overflow-hidden rounded-lg border border-stone-200 transition-shadow hover:shadow-sm dark:border-stone-700"
                            >
                              {serviceVideoPreview.thumbnailUrl ? (
                                <div className="relative">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={serviceVideoPreview.thumbnailUrl}
                                    alt={`${svc.title} video cover`}
                                    className="aspect-video w-full object-cover"
                                    loading="lazy"
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center">
                                    <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                                      <PlayCircle size={13} />
                                      Watch
                                    </span>
                                  </span>
                                </div>
                              ) : (
                                <span className={`px-3 py-2.5 text-sm ${ui.link}`}>
                                  <PlayCircle size={14} />
                                  Watch service video
                                </span>
                              )}
                            </a>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mx-auto mt-10 w-full max-w-5xl pb-4">
        <h2 className={ui.h2}>Upcoming classes</h2>
        {classes.length === 0 ? (
          <div className={`mt-4 ${ui.emptyState}`}>
            <p className={ui.muted}>No upcoming classes yet.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {classes.map((s) => {
              const dt = new Date(s.start_time);
              const dateLabel = dt.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
              const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
              const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
              const classSlug = cls?.share_slug;
              const href = classSlug
                ? `/class/${studio.public_slug}/${classSlug}?session_id=${s.id}`
                : `/booking/${studio.public_slug}`;
              return (
                <Link key={s.id} href={href} className={`${ui.card} block transition-shadow hover:shadow-md`}>
                  <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                    <div>
                      {cls?.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cls.image_url}
                          alt={cls?.title ?? "Class cover"}
                          className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                          loading="lazy"
                        />
                      ) : (
                        <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {cls?.title ?? "Class"}
                      </p>
                      <p className={`mt-1 text-sm ${ui.muted}`}>{dateLabel} · {timeLabel}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                          SGD {Number(s.guest_price ?? 0).toFixed(2)}
                        </span>
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                          {Number(s.spots_left ?? 0)} spots left
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {waLink ? (
        <a
          href={waLink}
          target="_blank"
          rel="noreferrer"
          aria-label="Chat on WhatsApp"
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-teal-600 px-4 text-sm font-semibold text-white shadow-lg shadow-teal-900/30 transition hover:bg-teal-500 active:scale-[0.98] dark:bg-teal-500 dark:hover:bg-teal-400"
        >
          <MessageCircle size={17} />
          WhatsApp
        </a>
      ) : null}
    </main>
  );
}
