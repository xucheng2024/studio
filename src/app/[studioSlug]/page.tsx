import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { SubscribeMembershipPanel } from "@/components/SubscribeMembershipPanel";
import { StudioAccountEntry } from "@/components/StudioAccountEntry";
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
    .select("id, name, public_slug, contract_status, public_intro, public_cover_image_url, public_video_url, public_services_title, public_classes_title, public_packages_title, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text, hitpay_enabled")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: services } = await admin
    .from("studio_services")
    .select("id, title, summary, description, price, currency, cover_image_url, video_url, tags, share_slug, sort_order")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const nowIso = new Date().toISOString();
  const { data: classes } = await admin
    .from("class_sessions")
    .select("id, start_time, spots_left, capacity, guest_price, credits_required, class_title_snapshot, class_description_snapshot, class_image_url_snapshot, classes!inner(title, description, share_slug, image_url, tags, studio_id, is_active, capacity)")
    .eq("classes.studio_id", studio.id)
    .eq("classes.is_active", true)
    .eq("status", "scheduled")
    .gte("start_time", nowIso)
    .order("start_time", { ascending: true })
    .limit(8);

  const { data: packages } = await admin
    .from("packages")
    .select("id, name, price, credits, expiry_days, location_id, image_url, video_url, share_slug")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("price", { ascending: true });

  const { data: memberships } = await admin
    .from("membership_products")
    .select("id, name, description, price, currency, billing_interval, trial_days, image_url, video_url, share_slug")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const { data: events } = await admin
    .from("events")
    .select("id, title, description, tags, start_time, end_time, capacity, spots_left, price, currency, share_slug, image_url, video_url, is_active")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("start_time", { ascending: true })
    .limit(12);

  return {
    studio,
    services: services ?? [],
    classes: classes ?? [],
    packages: packages ?? [],
    memberships: memberships ?? [],
    events: events ?? [],
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
  const { studio, services, classes, packages, memberships, events } = data;

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
  const servicesTitle = studio.public_services_title?.trim() || "General services";
  const classesTitle = studio.public_classes_title?.trim() || "Upcoming classes";
  const packagesTitle = studio.public_packages_title?.trim() || "Packages";
  const membershipsTitle = "Memberships";
  const eventsTitle = "Events";
  const visibleServices = services.slice(0, 4);
  const hiddenServices = services.slice(4);
  const visibleClasses = classes.slice(0, 4);
  const hiddenClasses = classes.slice(4);
  const nowMs = Date.now();
  const upcomingEvents = (events ?? []).filter((e) => new Date(String(e.end_time)).getTime() >= nowMs);
  const pastEvents = (events ?? []).filter((e) => new Date(String(e.end_time)).getTime() < nowMs);
  const visibleEvents = upcomingEvents.slice(0, 4);
  const hiddenEvents = upcomingEvents.slice(4);
  const lightAnchorBtn =
    "inline-flex items-center rounded-xl border border-stone-200 bg-white/70 px-4 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:bg-white hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-100";
  const mediaTagClass =
    "inline-flex items-center rounded-full border border-stone-200/80 bg-stone-50 px-3 py-1 text-[11px] font-semibold tracking-[0.02em] text-stone-600 shadow-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300";
  const studioMediaCover = cover ?? studioVideoPreview.thumbnailUrl ?? null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-2 sm:px-6 sm:pt-4 lg:px-8">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className={`${ui.card} relative bg-linear-to-br from-white to-stone-50/70 dark:from-stone-900 dark:to-stone-950`}>
          <div className="absolute right-4 top-4 z-20">
            <StudioAccountEntry showMembershipsLink={memberships.length > 0} />
          </div>
          <div className="grid gap-5 sm:grid-cols-[minmax(260px,44%)_minmax(0,1fr)] sm:items-start">
            <div className="w-full">
              <PublicVideoCover
                title={studio.name}
                coverUrl={studioMediaCover}
                embedUrl={studioVideoPreview.embedUrl}
                fallbackUrl={studio.public_video_url ?? null}
                priority
              />
            </div>
            <div>
              {studio.public_intro?.trim() ? (
                <details className="group">
                  <summary className="cursor-pointer list-none text-sm leading-snug text-stone-700 dark:text-stone-300">
                    <span className="line-clamp-3 whitespace-pre-wrap">
                      {studio.public_intro.trim()}
                    </span>
                    <span className="mt-2 inline-flex text-sm font-semibold text-teal-700 group-open:hidden dark:text-teal-400">
                      Read more
                    </span>
                    <span className="mt-2 hidden text-sm font-semibold text-teal-700 group-open:inline-flex dark:text-teal-400">
                      Show less
                    </span>
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-snug text-stone-700 dark:text-stone-300">
                    {studio.public_intro.trim()}
                  </p>
                </details>
              ) : (
                <p className="text-sm leading-snug text-stone-700 dark:text-stone-300">
                  Welcome to our studio. Explore services and get in touch.
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-start gap-2.5">
                <a href="#services" className={lightAnchorBtn}>
                  Services
                </a>
                <a href="#upcoming-classes" className={lightAnchorBtn}>
                  Classes
                </a>
                {upcomingEvents.length > 0 ? (
                  <a href="#events" className={lightAnchorBtn}>
                    Events
                  </a>
                ) : null}
                {packages.length > 0 ? (
                  <a href="#packages" className={lightAnchorBtn}>
                    Packages
                  </a>
                ) : null}
                {memberships.length > 0 ? (
                  <a href="#memberships" className={lightAnchorBtn}>
                    Memberships
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      {services.length > 0 ? (
        <section id="services" className="mx-auto mt-10 w-full max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className={ui.h2}>{servicesTitle}</h2>
            </div>
          </div>
          <div className="mt-4 grid gap-4">
            {visibleServices.map((svc) => {
              const serviceWaLink = buildServiceWaLink(svc.title);
              const servicePath = `/service/${studio.public_slug}/${svc.share_slug}`;
              return (
                <article key={svc.id} className={ui.card}>
                  <div className="grid gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                    <div className="shrink-0">
                      <Link href={servicePath} className="block">
                        <div className="relative">
                          {svc.cover_image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={svc.cover_image_url} alt={svc.title} className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800" />
                          ) : (
                            <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                          )}
                          {svc.price != null ? (
                            <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                              {svc.currency} {Number(svc.price).toFixed(2)}
                            </span>
                          ) : null}
                          <div className="absolute bottom-2 right-2 z-20">
                            <SessionShareLinkButton
                              sharePath={servicePath}
                              title={`${svc.title} · ${studio.name}`}
                              text={`Check out this service: ${svc.title}`}
                            />
                          </div>
                        </div>
                      </Link>
                      {Array.isArray((svc as { tags?: string[] | null }).tags) && (svc as { tags: string[] }).tags.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {Array.from(
                            new Map(
                              (svc as { tags: string[] }).tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")]),
                            ).values(),
                          )
                            .filter(Boolean)
                            .map((tag) => (
                            <span key={`${svc.id}-${tag}`} className={mediaTagClass}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                          <Link href={servicePath} className="transition hover:text-teal-700 dark:hover:text-teal-400">
                            {svc.title}
                          </Link>
                        </h3>
                      </div>
                      {svc.summary ? (
                        <p className={`mt-2 line-clamp-2 text-sm ${ui.muted}`}>{svc.summary}</p>
                      ) : null}
                      {svc.description ? (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
                          {svc.description}
                        </p>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link href={servicePath} className={ui.btnPrimarySm}>
                          View details
                        </Link>
                        {serviceWaLink ? (
                          <a
                            href={serviceWaLink}
                            target="_blank"
                            rel="noreferrer"
                            className={ui.btnSecondarySm}
                          >
                            Enquire Now
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {hiddenServices.length > 0 ? (
            <details className="group mt-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-teal-700 dark:text-teal-400">
                <span className="group-open:hidden">Show {hiddenServices.length} more services</span>
                <span className="hidden group-open:inline">Show fewer services</span>
              </summary>
              <div className="mt-4 grid gap-4">
                {hiddenServices.map((svc) => {
                  const serviceWaLink = buildServiceWaLink(svc.title);
                  const servicePath = `/service/${studio.public_slug}/${svc.share_slug}`;
                  return (
                    <article key={svc.id} className={ui.card}>
                      <div className="grid gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                        <div className="shrink-0">
                          <Link href={servicePath} className="block">
                            <div className="relative">
                              {svc.cover_image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={svc.cover_image_url} alt={svc.title} className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800" />
                              ) : (
                                <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                              )}
                              {svc.price != null ? (
                                <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                                  {svc.currency} {Number(svc.price).toFixed(2)}
                                </span>
                              ) : null}
                              <div className="absolute bottom-2 right-2 z-20">
                                <SessionShareLinkButton
                                  sharePath={servicePath}
                                  title={`${svc.title} · ${studio.name}`}
                                  text={`Check out this service: ${svc.title}`}
                                />
                              </div>
                            </div>
                          </Link>
                          {Array.isArray((svc as { tags?: string[] | null }).tags) && (svc as { tags: string[] }).tags.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {Array.from(
                                new Map(
                                  (svc as { tags: string[] }).tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")]),
                                ).values(),
                              )
                                .filter(Boolean)
                                .map((tag) => (
                                <span key={`${svc.id}-${tag}`} className={mediaTagClass}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                              <Link href={servicePath} className="transition hover:text-teal-700 dark:hover:text-teal-400">
                                {svc.title}
                              </Link>
                            </h3>
                          </div>
                          {svc.summary ? (
                            <p className={`mt-2 line-clamp-2 text-sm ${ui.muted}`}>{svc.summary}</p>
                          ) : null}
                          {svc.description ? (
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
                              {svc.description}
                            </p>
                          ) : null}
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link href={servicePath} className={ui.btnPrimarySm}>
                              View details
                            </Link>
                            {serviceWaLink ? (
                              <a
                                href={serviceWaLink}
                                target="_blank"
                                rel="noreferrer"
                                className={ui.btnSecondarySm}
                              >
                                Enquire Now
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {classes.length > 0 ? (
        <section id="upcoming-classes" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex items-center gap-2">
            <h2 className={ui.h2}>{classesTitle}</h2>
          </div>
          <div className="mt-4 grid w-full gap-4">
            {visibleClasses.map((s) => {
              const dt = new Date(s.start_time);
              const dateLabel = dt.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
              const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
              const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
              const classTitle = (s as { class_title_snapshot?: string | null }).class_title_snapshot?.trim() || cls?.title || "Class";
              const classDescription =
                (s as { class_description_snapshot?: string | null }).class_description_snapshot?.trim()
                || cls?.description?.trim()
                || "";
              const classImage = (s as { class_image_url_snapshot?: string | null }).class_image_url_snapshot ?? cls?.image_url ?? null;
              const sessionCapacity = Number((s as { capacity?: number | null }).capacity ?? cls?.capacity ?? 0) || 0;
              const spotsLeft = Number(s.spots_left ?? 0);
              const creditsRequired = Number(s.credits_required ?? 0);
              const spotsText = spotsLeft === 0
                ? sessionCapacity > 0 ? `0/${sessionCapacity} spots left` : "Full"
                : sessionCapacity > 0
                  ? `${spotsLeft}/${sessionCapacity} spots left`
                  : `${spotsLeft} spots left`;
              const classSlug = cls?.share_slug;
              const href = classSlug
                ? `/class/${studio.public_slug}/${classSlug}?session_id=${s.id}`
                : `/booking/${studio.public_slug}`;
              return (
                <article
                  key={s.id}
                  className={`${ui.card} transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}
                >
                  <Link href={href} className="block w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2">
                    <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                      <div className="shrink-0">
                        <div className="relative">
                          {classImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={classImage}
                              alt={classTitle}
                              className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                              loading="lazy"
                            />
                          ) : (
                            <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                          )}
                          {s.guest_price != null ? (
                            <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                              SGD {Number(s.guest_price).toFixed(2)}
                            </span>
                          ) : null}
                          {creditsRequired > 0 ? (
                            <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/92 px-2.5 py-1 text-xs font-semibold text-stone-700 backdrop-blur-sm dark:bg-stone-900/80 dark:text-stone-200">
                              {creditsRequired} class pass{creditsRequired !== 1 ? "es" : ""}
                            </span>
                          ) : null}
                          <div className="absolute bottom-2 right-2 z-20">
                            <SessionShareLinkButton
                              sharePath={href}
                              title={`${classTitle} · ${studio.name}`}
                              text={`Book this session: ${classTitle}`}
                            />
                          </div>
                        </div>
                        {Array.isArray((cls as { tags?: string[] | null } | null)?.tags) && (cls as { tags: string[] }).tags.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {Array.from(
                              new Map(
                                (cls as { tags: string[] }).tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")]),
                              ).values(),
                            )
                              .filter(Boolean)
                              .map((tag) => (
                              <span key={`${s.id}-${tag.toLowerCase()}`} className={mediaTagClass}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <p className={`text-sm ${ui.muted}`}>
                          {dateLabel} · {timeLabel}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
                          {cls?.title ?? "Class"}
                        </h3>
                        {classDescription ? (
                          <p className="mt-2 line-clamp-4 text-sm text-stone-700 dark:text-stone-300">
                            {classDescription}
                          </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <span className={ui.btnPrimarySm}>Book now</span>
                          <span className={`text-sm ${ui.muted}`}>{spotsText}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </article>
              );
            })}
          </div>
          {hiddenClasses.length > 0 ? (
            <details className="group mt-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-teal-700 dark:text-teal-400">
                <span className="group-open:hidden">Show {hiddenClasses.length} more classes</span>
                <span className="hidden group-open:inline">Show fewer classes</span>
              </summary>
              <div className="mt-4 grid w-full gap-4">
                {hiddenClasses.map((s) => {
                  const dt = new Date(s.start_time);
                  const dateLabel = dt.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
                  const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
                  const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
                  const classTitle = (s as { class_title_snapshot?: string | null }).class_title_snapshot?.trim() || cls?.title || "Class";
                  const classDescription =
                    (s as { class_description_snapshot?: string | null }).class_description_snapshot?.trim()
                    || cls?.description?.trim()
                    || "";
                  const classImage = (s as { class_image_url_snapshot?: string | null }).class_image_url_snapshot ?? cls?.image_url ?? null;
                  const sessionCapacity = Number((s as { capacity?: number | null }).capacity ?? cls?.capacity ?? 0) || 0;
                  const spotsLeft = Number(s.spots_left ?? 0);
                  const creditsRequired = Number(s.credits_required ?? 0);
                  const spotsText = spotsLeft === 0
                    ? sessionCapacity > 0 ? `0/${sessionCapacity} spots left` : "Full"
                    : sessionCapacity > 0
                      ? `${spotsLeft}/${sessionCapacity} spots left`
                      : `${spotsLeft} spots left`;
                  const classSlug = cls?.share_slug;
                  const href = classSlug
                    ? `/class/${studio.public_slug}/${classSlug}?session_id=${s.id}`
                    : `/booking/${studio.public_slug}`;
                  return (
                    <article
                      key={s.id}
                      className={`${ui.card} transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}
                    >
                      <Link href={href} className="block w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2">
                        <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                          <div className="shrink-0">
                            <div className="relative">
                              {classImage ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={classImage}
                                  alt={classTitle}
                                  className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                              )}
                              {s.guest_price != null ? (
                                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                                  SGD {Number(s.guest_price).toFixed(2)}
                                </span>
                              ) : null}
                              {creditsRequired > 0 ? (
                                <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/92 px-2.5 py-1 text-xs font-semibold text-stone-700 backdrop-blur-sm dark:bg-stone-900/80 dark:text-stone-200">
                                  {creditsRequired} class pass{creditsRequired !== 1 ? "es" : ""}
                                </span>
                              ) : null}
                              <div className="absolute bottom-2 right-2 z-20">
                                <SessionShareLinkButton
                                  sharePath={href}
                                  title={`${classTitle} · ${studio.name}`}
                                  text={`Book this session: ${classTitle}`}
                                />
                              </div>
                            </div>
                            {Array.isArray((cls as { tags?: string[] | null } | null)?.tags) && (cls as { tags: string[] }).tags.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {Array.from(
                                  new Map(
                                    (cls as { tags: string[] }).tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")]),
                                  ).values(),
                                )
                                  .filter(Boolean)
                                  .map((tag) => (
                                  <span key={`${s.id}-${tag.toLowerCase()}`} className={mediaTagClass}>
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <p className={`text-sm ${ui.muted}`}>
                              {dateLabel} · {timeLabel}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
                              {classTitle}
                            </h3>
                            {classDescription ? (
                              <p className="mt-2 line-clamp-4 text-sm text-stone-700 dark:text-stone-300">
                                {classDescription}
                              </p>
                            ) : null}
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                              <span className={ui.btnPrimarySm}>Book now</span>
                              <span className={`text-sm ${ui.muted}`}>{spotsText}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </article>
                  );
                })}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {upcomingEvents.length > 0 ? (
        <section id="events" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex items-center gap-2">
            <h2 className={ui.h2}>{eventsTitle}</h2>
          </div>
          <div className="mt-4 grid w-full gap-4">
            {visibleEvents.map((e) => {
              const start = new Date(String(e.start_time));
              const end = new Date(String(e.end_time));
              const dateLabel = start.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
              const timeLabel = start.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
              const endLabel = end.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
              const href = e.share_slug ? `/event/${studio.public_slug}/${e.share_slug}` : `/${studio.public_slug}`;
              const tags = Array.isArray((e as { tags?: string[] | null }).tags) ? (e as { tags: string[] }).tags : [];
              const eSpotsLeft = Number(e.spots_left ?? 0);
              const eCapacity = Number(e.capacity ?? 0);
              const eSpotsText = eSpotsLeft === 0
                ? eCapacity > 0 ? `0/${eCapacity} spots left` : "Full"
                : eCapacity > 0 ? `${eSpotsLeft}/${eCapacity} spots left` : `${eSpotsLeft} spots left`;
              return (
                <article key={e.id} className={`${ui.card} transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}>
                  <Link href={href} className="block w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2">
                    <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                      <div className="shrink-0">
                        <div className="relative">
                          {(e as { image_url?: string | null }).image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={String((e as { image_url?: string | null }).image_url)}
                              alt={String(e.title ?? "")}
                              className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                              loading="lazy"
                            />
                          ) : (
                            <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                          )}
                          {e.price != null ? (
                            <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                              {String(e.currency ?? "SGD")} {Number(e.price).toFixed(2)}
                            </span>
                          ) : null}
                          <div className="absolute bottom-2 right-2 z-20">
                            <SessionShareLinkButton
                              sharePath={href}
                              title={`${String(e.title ?? "Event")} · ${studio.name}`}
                              text={`Check out this event: ${String(e.title ?? "Event")}`}
                            />
                          </div>
                        </div>
                        {tags.length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {Array.from(new Map(tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values())
                              .filter(Boolean)
                              .slice(0, 4)
                              .map((tag) => (
                                <span key={`${e.id}-${tag.toLowerCase()}`} className={mediaTagClass}>
                                  {tag}
                                </span>
                              ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <p className={`text-sm ${ui.muted}`}>
                          {dateLabel} · {timeLabel}–{endLabel}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
                          {String(e.title ?? "Event")}
                        </h3>
                        {(e as { description?: string | null }).description ? (
                          <p className="mt-2 line-clamp-4 text-sm text-stone-700 dark:text-stone-300">
                            {String((e as { description?: string | null }).description)}
                          </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <span className={ui.btnPrimarySm}>Book now</span>
                          <span className={`text-sm ${ui.muted}`}>{eSpotsText}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </article>
              );
            })}
          </div>

          {hiddenEvents.length > 0 ? (
            <details className="group mt-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-teal-700 dark:text-teal-400">
                <span className="group-open:hidden">Show {hiddenEvents.length} more events</span>
                <span className="hidden group-open:inline">Show fewer events</span>
              </summary>
              <div className="mt-4 grid w-full gap-4">
                {hiddenEvents.map((e) => {
                  const start = new Date(String(e.start_time));
                  const end = new Date(String(e.end_time));
                  const dateLabel = start.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
                  const timeLabel = start.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
                  const endLabel = end.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
                  const href = e.share_slug ? `/event/${studio.public_slug}/${e.share_slug}` : `/${studio.public_slug}`;
                  const tags = Array.isArray((e as { tags?: string[] | null }).tags) ? (e as { tags: string[] }).tags : [];
                  const eSpotsLeft = Number(e.spots_left ?? 0);
                  const eCapacity = Number(e.capacity ?? 0);
                  const eSpotsText = eSpotsLeft === 0
                    ? eCapacity > 0 ? `0/${eCapacity} spots left` : "Full"
                    : eCapacity > 0 ? `${eSpotsLeft}/${eCapacity} spots left` : `${eSpotsLeft} spots left`;
                  return (
                    <article key={e.id} className={`${ui.card} transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}>
                      <Link href={href} className="block w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2">
                        <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                          <div className="shrink-0">
                            <div className="relative">
                              {(e as { image_url?: string | null }).image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={String((e as { image_url?: string | null }).image_url)}
                                  alt={String(e.title ?? "")}
                                  className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                              )}
                              {e.price != null ? (
                                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                                  {String(e.currency ?? "SGD")} {Number(e.price).toFixed(2)}
                                </span>
                              ) : null}
                              <div className="absolute bottom-2 right-2 z-20">
                                <SessionShareLinkButton
                                  sharePath={href}
                                  title={`${String(e.title ?? "Event")} · ${studio.name}`}
                                  text={`Check out this event: ${String(e.title ?? "Event")}`}
                                />
                              </div>
                            </div>
                            {tags.length ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {Array.from(new Map(tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values())
                                  .filter(Boolean)
                                  .slice(0, 4)
                                  .map((tag) => (
                                    <span key={`${e.id}-${tag.toLowerCase()}`} className={mediaTagClass}>
                                      {tag}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <p className={`text-sm ${ui.muted}`}>
                              {dateLabel} · {timeLabel}–{endLabel}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
                              {String(e.title ?? "Event")}
                            </h3>
                            {(e as { description?: string | null }).description ? (
                              <p className="mt-2 line-clamp-4 text-sm text-stone-700 dark:text-stone-300">
                                {String((e as { description?: string | null }).description)}
                              </p>
                            ) : null}
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                              <span className={ui.btnPrimarySm}>Book now</span>
                              <span className={`text-sm ${ui.muted}`}>{eSpotsText}</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </article>
                  );
                })}
              </div>
            </details>
          ) : null}

          {pastEvents.length > 0 ? (
            <details className="group mt-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-teal-700 dark:text-teal-400">
                <span className="group-open:hidden">Show {pastEvents.length} past events</span>
                <span className="hidden group-open:inline">Hide past events</span>
              </summary>
              <div className="mt-4 grid w-full gap-4">
                {pastEvents.map((e) => {
                  const start = new Date(String(e.start_time));
                  const end = new Date(String(e.end_time));
                  const dateLabel = start.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
                  const timeLabel = start.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
                  const endLabel = end.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
                  const href = e.share_slug ? `/event/${studio.public_slug}/${e.share_slug}` : `/${studio.public_slug}`;
                  const tags = Array.isArray((e as { tags?: string[] | null }).tags) ? (e as { tags: string[] }).tags : [];
                  return (
                    <article key={e.id} className={`${ui.card} opacity-70`}>
                      <Link href={href} className="block w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2">
                        <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                          <div className="shrink-0">
                            <div className="relative">
                              {(e as { image_url?: string | null }).image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={String((e as { image_url?: string | null }).image_url)}
                                  alt={String(e.title ?? "")}
                                  className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                              )}
                              {e.price != null ? (
                                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                                  {String(e.currency ?? "SGD")} {Number(e.price).toFixed(2)}
                                </span>
                              ) : null}
                              <div className="absolute bottom-2 right-2 z-20">
                                <SessionShareLinkButton
                                  sharePath={href}
                                  title={`${String(e.title ?? "Event")} · ${studio.name}`}
                                  text={`Check out this event: ${String(e.title ?? "Event")}`}
                                />
                              </div>
                            </div>
                            {tags.length ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {Array.from(new Map(tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values())
                                  .filter(Boolean)
                                  .slice(0, 4)
                                  .map((tag) => (
                                    <span key={`${e.id}-${tag.toLowerCase()}`} className={mediaTagClass}>
                                      {tag}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <p className={`text-sm ${ui.muted}`}>
                              {dateLabel} · {timeLabel}–{endLabel}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
                              {String(e.title ?? "Event")}
                            </h3>
                            {(e as { description?: string | null }).description ? (
                              <p className="mt-2 line-clamp-4 text-sm text-stone-700 dark:text-stone-300">
                                {String((e as { description?: string | null }).description)}
                              </p>
                            ) : null}
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                              <span className={`${ui.btnSecondarySm}`}>View details</span>
                              <span className={`text-sm ${ui.muted}`}>Event ended</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </article>
                  );
                })}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {packages.length > 0 ? (
        <section id="packages" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex items-center gap-2">
            <h2 className={ui.h2}>{packagesTitle}</h2>
          </div>
          <p className={`mt-1 text-sm ${ui.muted}`}>
            Buy a class pass pack and book any upcoming session.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {packages.map((pkg) => {
              const buyHref = pkg.share_slug
                ? `/buy/${studio.public_slug}/${pkg.share_slug}`
                : null;
              const pkgImage = (pkg as { image_url?: string | null }).image_url ?? null;
              const pkgVideo = (pkg as { video_url?: string | null }).video_url ?? null;
              const pkgVideoPreview = getVideoPreview(pkgVideo ?? "");
              const showVideoCover = Boolean(pkgVideoPreview.embedUrl || pkgVideo?.trim());
              return (
                <article key={pkg.id} className={`${ui.card} flex flex-col`}>
                  <div className="mb-4">
                    {showVideoCover ? (
                      <PublicVideoCover
                        title={pkg.name}
                        coverUrl={pkgImage}
                        embedUrl={pkgVideoPreview.embedUrl}
                        fallbackUrl={pkgVideo?.trim() || null}
                      />
                    ) : pkgImage ? (
                      buyHref ? (
                        <Link href={buyHref} className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={pkgImage}
                            alt={pkg.name}
                            className="aspect-video w-full rounded-xl border border-stone-200 object-cover dark:border-stone-800"
                            loading="lazy"
                          />
                        </Link>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={pkgImage}
                          alt={pkg.name}
                          className="aspect-video w-full rounded-xl border border-stone-200 object-cover dark:border-stone-800"
                          loading="lazy"
                        />
                      )
                    ) : buyHref ? (
                      <Link
                        href={buyHref}
                        className="block aspect-video w-full rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900"
                        aria-label={`View ${pkg.name}`}
                      />
                    ) : (
                      <div className="aspect-video w-full rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col">
                    <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                      {buyHref ? (
                        <Link href={buyHref} className="transition hover:text-teal-700 dark:hover:text-teal-400">
                          {pkg.name}
                        </Link>
                      ) : (
                        pkg.name
                      )}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className={`text-sm ${ui.muted}`}>
                        {pkg.credits} class pass{Number(pkg.credits) !== 1 ? "es" : ""}
                      </span>
                      {pkg.expiry_days ? (
                        <span className={`text-sm ${ui.muted}`}>· Expires in {pkg.expiry_days} days</span>
                      ) : (
                        <span className={`text-sm ${ui.muted}`}>· No expiry</span>
                      )}
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-4">
                      {pkg.price != null ? (
                        <span className="text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                          SGD {Number(pkg.price).toFixed(2)}
                        </span>
                      ) : null}
                      {buyHref ? (
                        <Link href={buyHref} className={ui.btnPrimary}>
                          Buy now
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {memberships.length > 0 ? (
        <section id="memberships" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex items-center gap-2">
            <h2 className={ui.h2}>{membershipsTitle}</h2>
          </div>
          <p className={`mt-1 text-sm ${ui.muted}`}>
            Start a recurring membership with automatic monthly or yearly billing.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {memberships.map((membership) => {
              const detailHref = membership.share_slug
                ? `/membership/${studio.public_slug}/${membership.share_slug}`
                : null;
              const membershipImage = (membership as { image_url?: string | null }).image_url ?? null;
              const membershipVideo = (membership as { video_url?: string | null }).video_url ?? null;
              const membershipVideoPreview = getVideoPreview(membershipVideo ?? "");
              const showVideoCover = Boolean(membershipVideoPreview.embedUrl || membershipVideo?.trim());
              const intervalLabel = membership.billing_interval === "yearly" ? "Yearly" : "Monthly";

              return (
                <article key={membership.id} className={`${ui.card} flex flex-col`}>
                  <div className="mb-4">
                    {showVideoCover ? (
                      <PublicVideoCover
                        title={membership.name}
                        coverUrl={membershipImage}
                        embedUrl={membershipVideoPreview.embedUrl}
                        fallbackUrl={membershipVideo?.trim() || null}
                      />
                    ) : membershipImage ? (
                      detailHref ? (
                        <Link href={detailHref} className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={membershipImage}
                            alt={membership.name}
                            className="aspect-video w-full rounded-xl border border-stone-200 object-cover dark:border-stone-800"
                            loading="lazy"
                          />
                        </Link>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={membershipImage}
                          alt={membership.name}
                          className="aspect-video w-full rounded-xl border border-stone-200 object-cover dark:border-stone-800"
                          loading="lazy"
                        />
                      )
                    ) : (
                      <div className="aspect-video w-full rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col">
                    <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                      {detailHref ? (
                        <Link href={detailHref} className="transition hover:text-teal-700 dark:hover:text-teal-400">
                          {membership.name}
                        </Link>
                      ) : (
                        membership.name
                      )}
                    </h3>
                    <p className={`mt-1.5 text-sm ${ui.muted}`}>{intervalLabel} membership</p>
                    {membership.description ? (
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">
                        {membership.description}
                      </p>
                    ) : null}
                    <div className="mt-auto flex flex-col gap-3 pt-4">
                      <div className="flex items-end justify-between gap-3">
                        <span className="text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                          {membership.currency} {Number(membership.price).toFixed(2)}
                        </span>
                        {detailHref ? (
                          <Link href={detailHref} className={ui.btnSecondarySm}>
                            View details
                          </Link>
                        ) : null}
                      </div>
                      <SubscribeMembershipPanel
                        membershipId={membership.id}
                        studioSlug={studio.public_slug}
                        membershipSlug={membership.share_slug ?? ""}
                        disabled={!studio.hitpay_enabled}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

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
