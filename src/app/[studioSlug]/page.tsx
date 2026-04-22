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
  const studioVideoPreview = getVideoPreview(studio.public_video_url);

  return (
    <main className={ui.page}>
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <div className={`${ui.card} bg-linear-to-br from-white to-stone-50/70 dark:from-stone-900 dark:to-stone-950`}>
          <div className="grid gap-5 sm:grid-cols-[168px_1fr] sm:items-start">
            <div className="w-full">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt={`${studio.name} portrait`}
                  className="aspect-square w-full rounded-2xl border border-stone-200 object-cover shadow-sm dark:border-stone-700"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-square w-full rounded-2xl bg-stone-100 dark:bg-stone-900" />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
                About me
              </p>
              {studio.public_intro?.trim() ? (
                <details className="group">
                  <summary className={`mt-2 cursor-pointer list-none text-[1.05rem] leading-relaxed text-stone-700 dark:text-stone-300`}>
                    <span className="line-clamp-4 whitespace-pre-wrap">
                      {studio.public_intro.trim()}
                    </span>
                    <span className="mt-3 inline-flex text-sm font-semibold text-teal-700 group-open:hidden dark:text-teal-400">
                      Read more
                    </span>
                    <span className="mt-3 hidden text-sm font-semibold text-teal-700 group-open:inline-flex dark:text-teal-400">
                      Show less
                    </span>
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-[1.02rem] leading-relaxed text-stone-700 dark:text-stone-300">
                    {studio.public_intro.trim()}
                  </p>
                </details>
              ) : (
                <p className="mt-2 text-[1.02rem] leading-relaxed text-stone-700 dark:text-stone-300">
                  Welcome to our studio. Explore services and get in touch.
                </p>
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
              const serviceWaLink = buildServiceWaLink(svc.title);
              return (
                <article key={svc.id} className={ui.card}>
                  <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                    <div className="relative">
                      {svc.cover_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={svc.cover_image_url} alt={svc.title} className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800" />
                      ) : (
                        <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                      )}
                      <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                        {svc.currency} {Number(svc.price ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{svc.title}</h3>
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
                      {serviceWaLink ? (
                        <div className="mt-4">
                          <a
                            href={serviceWaLink}
                            target="_blank"
                            rel="noreferrer"
                            className={ui.btnSecondarySm}
                          >
                            <MessageCircle size={14} />
                            Enquire Now
                          </a>
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
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
                <Link
                  key={s.id}
                  href={href}
                  className={`${ui.card} block transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}
                >
                  <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-center">
                    <div className="relative">
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
                      <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                        {dateLabel} · {timeLabel}
                      </span>
                      <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                        SGD {Number(s.guest_price ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <p className="text-base font-semibold text-stone-900 dark:text-stone-100">
                        {cls?.title ?? "Class"}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            Number(s.spots_left ?? 0) <= 3
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                              : "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                          }`}
                        >
                          {Number(s.spots_left ?? 0)} spots left
                        </span>
                      </div>
                      <span className={`${ui.btnPrimarySm} mt-3 inline-flex`}>Book</span>
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
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 z-40 inline-flex h-14 items-center gap-2 rounded-full border-2 border-white bg-[#25D366] px-4 text-white shadow-[0_10px_28px_rgba(37,211,102,0.38)] transition hover:brightness-105 active:scale-[0.98] dark:border-stone-950"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            className="h-6 w-6 shrink-0 fill-current"
            aria-hidden="true"
          >
            <path d="M19.11 17.24c-.27-.14-1.61-.8-1.86-.89-.25-.09-.43-.14-.61.14-.18.27-.7.89-.86 1.07-.16.18-.32.2-.59.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.59-1.5-1.86-.16-.27-.02-.41.12-.54.12-.12.27-.32.41-.48.14-.16.18-.27.27-.46.09-.18.05-.34-.02-.48-.07-.14-.61-1.48-.84-2.03-.22-.53-.44-.46-.61-.47h-.52c-.18 0-.48.07-.73.34-.25.27-.95.93-.95 2.27s.98 2.64 1.11 2.82c.14.18 1.92 2.93 4.66 4.11.65.28 1.15.45 1.55.58.65.21 1.24.18 1.71.11.52-.08 1.61-.66 1.84-1.3.23-.64.23-1.19.16-1.3-.07-.11-.25-.18-.52-.32z" />
            <path d="M16.01 3.2c-7.06 0-12.78 5.72-12.78 12.78 0 2.25.59 4.45 1.71 6.39L3.2 28.8l6.58-1.72a12.74 12.74 0 0 0 6.23 1.59h.01c7.06 0 12.78-5.72 12.78-12.78S23.08 3.2 16.01 3.2zm0 23.36h-.01c-1.92 0-3.8-.52-5.45-1.49l-.39-.23-3.91 1.02 1.04-3.81-.25-.39a10.58 10.58 0 0 1-1.63-5.67c0-5.85 4.76-10.61 10.61-10.61 2.83 0 5.49 1.1 7.49 3.11a10.53 10.53 0 0 1 3.11 7.49c0 5.85-4.76 10.61-10.61 10.61z" />
          </svg>
          <span className="hidden text-sm font-semibold sm:inline">WhatsApp</span>
        </a>
      ) : null}
    </main>
  );
}
