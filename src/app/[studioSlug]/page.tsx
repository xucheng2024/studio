import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StudioMediaWarmup } from "@/components/StudioMediaWarmup";
import { CoverLocationCornerBadge, sessionLocationLabel } from "@/components/SessionDateMiniCalendar";
import { SessionShareLinkButton } from "@/components/SessionShareLinkButton";
import { StudioIntroSection } from "@/components/StudioIntroSection";
import { ShopProductCard } from "@/components/ShopProductCard";
import { StudioStickyNav, type StickyNavTab } from "@/components/StudioStickyNav";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import {
  studioClassPath,
  studioClassesPath,
  studioEventPath,
  studioEventsPath,
  studioHomePath,
  studioMemberZoneListPath,
  studioMemberZonePath,
  studioPackagesPath,
  studioPackagePath,
  studioServicePath,
  studioServicesPath,
  studioShopPath,
  studioShopProductPath,
} from "@/lib/public-paths";
import { isReservedPublicSlug, studioWhatsappLink } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { getVideoPreview } from "@/lib/videoPreview";

type Props = { params: Promise<{ studioSlug: string }> };


export async function generateStaticParams() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("studios")
    .select("public_slug")
    .neq("contract_status", "suspended")
    .not("public_slug", "is", null);
  return (data ?? [])
    .filter((s) => s.public_slug && !isReservedPublicSlug(s.public_slug))
    .map((s) => ({ studioSlug: s.public_slug as string }));
}

const getPublicStudioShell = async (studioSlugRaw: string) => {
  const slug = normalizeStudioSlug(studioSlugRaw ?? "");
  if (!slug || isReservedPublicSlug(slug)) return null;
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status, public_brand_name, public_logo_url, public_intro, public_cover_image_url, public_video_url, public_services_title, public_classes_title, public_packages_title, public_events_title, public_member_zone_title, public_shop_title, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text, hitpay_enabled")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;
  return studio;
};

const getPublicStudioData = async (studioSlugRaw: string) => {
  const studio = await getPublicStudioShell(studioSlugRaw);
  if (!studio) return null;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const [
    { data: services },
    { data: classes },
    { data: packages },
    { data: memberships },
    { data: events },
    { data: pastEvents },
    { data: memberZoneSeries },
    { data: shopProducts },
  ] = await Promise.all([
    admin
      .from("studio_services")
      .select("id, title, summary, description, price, currency, cover_image_url, video_url, tags, share_slug, sort_order")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("class_sessions")
      .select("id, start_time, spots_left, capacity, guest_price, credits_required, class_title_snapshot, class_description_snapshot, class_image_url_snapshot, locations(name), classes!inner(title, description, share_slug, image_url, tags, studio_id, is_active, capacity)")
      .eq("classes.studio_id", studio.id)
      .eq("classes.is_active", true)
      .eq("status", "scheduled")
      .gte("start_time", nowIso)
      .order("start_time", { ascending: true })
      .limit(8),
    admin
      .from("packages")
      .select("id, name, price, credits, expiry_days, location_id, share_slug")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("price", { ascending: true }),
    admin
      .from("membership_products")
      .select("id, name, description, price, currency, billing_interval, trial_days, share_slug")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    admin
      .from("events")
      .select("id, title, description, tags, start_time, end_time, capacity, spots_left, price, currency, share_slug, image_url, video_url, is_active")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .gte("end_time", nowIso)
      .order("start_time", { ascending: true })
      .limit(12),
    admin
      .from("events")
      .select("id, title, description, tags, start_time, end_time, capacity, spots_left, price, currency, share_slug, image_url, video_url, is_active")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .lt("end_time", nowIso)
      .order("start_time", { ascending: false })
      .limit(6),
    admin
      .from("member_zone_series")
      .select("id, title, summary, description, cover_image_url, promo_video_url, access_type, price, currency, share_slug, sort_order")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    admin
      .from("shop_products")
      .select("id, title, summary, image_url, price, currency, share_slug, stock_qty, sort_order")
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);

  return {
    studio,
    services: services ?? [],
    classes: classes ?? [],
    packages: packages ?? [],
    memberships: memberships ?? [],
    events: events ?? [],
    pastEvents: pastEvents ?? [],
    memberZoneSeries: memberZoneSeries ?? [],
    shopProducts: shopProducts ?? [],
  };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { studioSlug } = await params;
  const studio = await getPublicStudioShell(studioSlug);
  if (!studio) return { title: "Studio" };
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
  const { studio, services, classes, packages, memberships, events, pastEvents, memberZoneSeries, shopProducts } = data;

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
  const eventsTitle = (studio as { public_events_title?: string | null }).public_events_title?.trim() || "Events";
  const memberZoneTitle = (studio as { public_member_zone_title?: string | null }).public_member_zone_title?.trim() || "Member zone";
  const shopTitle = (studio as { public_shop_title?: string | null }).public_shop_title?.trim() || "Shop";
  const visibleServices = services.slice(0, 3);
  const hiddenServices = services.slice(3);
  const visibleClasses = classes.slice(0, 3);
  const hiddenClasses = classes.slice(3);
  const visibleEvents = (events ?? []).slice(0, 3);
  const hiddenEvents = (events ?? []).slice(3);
  const visiblePackages = packages.slice(0, 3);
  const hiddenPackages = packages.slice(3);
  const visibleMemberZoneSeries = memberZoneSeries.slice(0, 3);
  const hiddenMemberZoneSeries = memberZoneSeries.slice(3);
  const visibleShopProducts = shopProducts.slice(0, 4);
  const hiddenShopProducts = shopProducts.slice(4);
  const mediaTagClass =
    "inline-flex items-center rounded-full border border-stone-200/80 bg-stone-50 px-3 py-1 text-[11px] font-semibold tracking-[0.02em] text-stone-600 shadow-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300";
  const studioMediaCover = cover ?? studioVideoPreview.thumbnailUrl ?? null;
  const publicBrandName = studio.public_brand_name?.trim() || studio.name;
  const rawLogoUrl = studio.public_logo_url?.trim() || null;
  const logoUrl = rawLogoUrl && isTrustedCoverImageUrl(rawLogoUrl) ? rawLogoUrl : null;
  const warmupMediaUrls = Array.from(
    new Set(
      [
        logoUrl,
        studioMediaCover,
        ...visibleServices.map((svc) => svc.cover_image_url ?? null),
        ...visibleClasses.map((s) => {
          const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
          return (s as { class_image_url_snapshot?: string | null }).class_image_url_snapshot ?? cls?.image_url ?? null;
        }),
        ...visibleEvents.map((e) => (e as { image_url?: string | null }).image_url ?? null),
        ...memberZoneSeries.slice(0, 2).map((series) => {
          return series.cover_image_url ?? getVideoPreview(series.promo_video_url ?? "").thumbnailUrl ?? null;
        }),
        ...visibleShopProducts.slice(0, 2).map((product) => product.image_url ?? null),
      ]
        .map((url) => String(url ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);
  const studioBadgeLabel = publicBrandName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase() ?? "")
    .join("") || "S";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-0 sm:px-6 lg:px-8">
      <StudioMediaWarmup urls={warmupMediaUrls} />

      {/* ── Sticky header nav ── */}
      <StudioStickyNav
        studioSlug={studio.public_slug}
        studioName={publicBrandName}
        logoUrl={logoUrl}
        studioBadgeLabel={studioBadgeLabel}
        showMembershipsLink={memberships.length > 0}
        introSectionId="studio-intro"
        tabs={[
          { id: "studio-intro", label: "Intro" },
          ...(services.length > 0 ? [{ id: "services", label: "Services" }] : []),
          ...(classes.length > 0 ? [{ id: "upcoming-classes", label: "Classes" }] : []),
          ...((events ?? []).length > 0 || (pastEvents ?? []).length > 0 ? [{ id: "events", label: "Events" }] : []),
          ...(memberZoneSeries.length > 0 ? [{ id: "member-zone", label: "Member zone" }] : []),
          ...(shopProducts.length > 0 ? [{ id: "shop", label: "Shop" }] : []),
          ...(packages.length > 0 ? [{ id: "packages", label: "Packages" }] : []),
        ] satisfies StickyNavTab[]}
      />

      <section id="studio-intro" className="mt-4 scroll-mt-20">
        <StudioIntroSection
          studioName={studio.name}
          studioMediaCover={studioMediaCover}
          embedUrl={studioVideoPreview.embedUrl}
          videoUrl={studio.public_video_url ?? null}
          intro={studio.public_intro ?? null}
        />
      </section>

      {services.length > 0 ? (
        <section id="services" className="mx-auto mt-10 w-full max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className={ui.h2}>{servicesTitle}</h2>
            </div>
            {hiddenServices.length > 0 ? (
              <Link href={studioServicesPath(studio.public_slug)} className={ui.link}>
                See {hiddenServices.length}{" "}more &gt;
              </Link>
            ) : null}
          </div>
          <div className="mt-4 grid gap-4">
            {visibleServices.map((svc) => {
              const serviceWaLink = buildServiceWaLink(svc.title);
              const servicePath = studioServicePath(studio.public_slug, svc.share_slug);
              const svcVideoPreview = getVideoPreview((svc as { video_url?: string | null }).video_url ?? "");
              const svcCover = svc.cover_image_url ?? svcVideoPreview.thumbnailUrl ?? null;
              return (
                <article key={svc.id} className={ui.card}>
                  <div className="grid gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                    <div className="shrink-0">
                      <Link href={servicePath} className="block">
                        <div className="relative">
                          {svcCover ? (
                            <Image src={svcCover} alt={svc.title} width={1200} height={675} className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800" />
                          ) : (
                            <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                          )}
                          {svc.price != null && Number(svc.price) > 0 ? (
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
          </div>        </section>
      ) : null}

      {classes.length > 0 ? (
        <section id="upcoming-classes" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={ui.h2}>{classesTitle}</h2>
            {hiddenClasses.length > 0 ? (
              <Link href={studioClassesPath(studio.public_slug)} className={ui.link}>
                See {hiddenClasses.length}{" "}more &gt;
              </Link>
            ) : null}
          </div>
          <div className="mt-4 grid w-full gap-4">
            {visibleClasses.map((s) => {
              const dt = new Date(s.start_time);
              const dateLabel = dt.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Singapore" });
              const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
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
              const classCurrency = String((s as { currency?: string | null }).currency ?? "SGD").toUpperCase();
              const spotsText = spotsLeft === 0
                ? sessionCapacity > 0 ? `0/${sessionCapacity} spots left` : "Full"
                : sessionCapacity > 0
                  ? `${spotsLeft}/${sessionCapacity} spots left`
                  : `${spotsLeft} spots left`;
              const classShareSlug = String(cls?.share_slug ?? "")
                .trim()
                .toLowerCase();
              const canLinkToClass =
                classShareSlug.length >= 6 &&
                classShareSlug.length <= 80 &&
                /^[a-z0-9-]+$/.test(classShareSlug);
              const href = canLinkToClass
                ? studioClassPath(studio.public_slug, classShareSlug, `session_id=${s.id}`)
                : studioClassesPath(studio.public_slug);
              const locationName = sessionLocationLabel(s as { locations?: { name?: string | null } | { name?: string | null }[] | null });
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
                            <Image
                              src={classImage}
                              alt={classTitle}
                              width={1200}
                              height={675}
                              className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                            />
                          ) : (
                            <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                          )}
                          <CoverLocationCornerBadge name={locationName} />
                          {s.guest_price != null && Number(s.guest_price) > 0 ? (
                            <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                              {classCurrency} {Number(s.guest_price).toFixed(2)}
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
          </div>        </section>
      ) : null}

      {(events ?? []).length > 0 || (pastEvents ?? []).length > 0 ? (
        <section id="events" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={ui.h2}>{eventsTitle}</h2>
            {hiddenEvents.length > 0 || pastEvents.length > 0 ? (
              <Link href={studioEventsPath(studio.public_slug)} className={ui.link}>
                See {hiddenEvents.length + pastEvents.length}{" "}more &gt;
              </Link>
            ) : null}
          </div>
          <div className="mt-4 grid w-full gap-4">
            {visibleEvents.map((e) => {
              const start = new Date(String(e.start_time));
              const end = new Date(String(e.end_time));
              const dateLabel = start.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Singapore" });
              const timeLabel = start.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
              const endLabel = end.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
              const href = e.share_slug ? studioEventPath(studio.public_slug, e.share_slug) : studioHomePath(studio.public_slug);
              const tags = Array.isArray((e as { tags?: string[] | null }).tags) ? (e as { tags: string[] }).tags : [];
              const eSpotsLeft = Number(e.spots_left ?? 0);
              const eCapacity = Number(e.capacity ?? 0);
              const eSpotsText = eSpotsLeft === 0
                ? eCapacity > 0 ? `0/${eCapacity} spots left` : "Full"
                : eCapacity > 0 ? `${eSpotsLeft}/${eCapacity} spots left` : `${eSpotsLeft} spots left`;
              const eVideoPreview = getVideoPreview(String((e as { video_url?: string | null }).video_url ?? ""));
              const eCover = (e as { image_url?: string | null }).image_url ?? eVideoPreview.thumbnailUrl ?? null;
              return (
                <article key={e.id} className={`${ui.card} transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}>
                  <Link href={href} className="block w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:ring-offset-2">
                    <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                      <div className="shrink-0">
                        <div className="relative">
                          {eCover ? (
                            <Image
                              src={eCover}
                              alt={String(e.title ?? "")}
                              width={1200}
                              height={675}
                              className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                            />
                          ) : (
                            <div className="aspect-video w-full rounded-lg bg-stone-100 dark:bg-stone-900" />
                          )}
                          {e.price != null && Number(e.price) > 0 ? (
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
        </section>
      ) : null}

      {memberZoneSeries.length > 0 ? (
        <section id="member-zone" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className={ui.h2}>{memberZoneTitle}</h2>
            {hiddenMemberZoneSeries.length > 0 ? (
              <Link href={studioMemberZoneListPath(studio.public_slug)} className={`${ui.link} shrink-0`}>
                See {hiddenMemberZoneSeries.length}{" "}more &gt;
              </Link>
            ) : null}
          </div>
          <p className={`mt-1 text-sm ${ui.muted}`}>Exclusive audio &amp; video lesson series for members.</p>
          <div className="mt-4 grid gap-4">
            {visibleMemberZoneSeries.map((series) => {
              const href = studioMemberZonePath(studio.public_slug, series.share_slug);
              const hasSeriesPrice = series.price != null && Number(series.price) > 0;
              const priceStr = hasSeriesPrice ? `${String(series.currency ?? "SGD").toUpperCase()} ${Number(series.price).toFixed(2)}` : null;
              const accessTag =
                series.access_type === "free"
                  ? { label: "Free", color: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-900/30 dark:text-teal-300" }
                  : series.access_type === "paid_only"
                    ? { label: priceStr ?? "Paid", color: "bg-stone-100 text-stone-700 ring-stone-400/20 dark:bg-stone-800 dark:text-stone-300" }
                    : series.access_type === "member_or_paid"
                      ? { label: priceStr ? `From ${priceStr}` : "Member or paid", color: "bg-stone-100 text-stone-700 ring-stone-400/20 dark:bg-stone-800 dark:text-stone-300" }
                      : { label: "Members only", color: "bg-stone-100 text-stone-700 ring-stone-400/20 dark:bg-stone-800 dark:text-stone-300" };
              const ctaLabel = "View series";
              const seriesPromoPreview = getVideoPreview(series.promo_video_url ?? "");
              const seriesCover = series.cover_image_url ?? seriesPromoPreview.thumbnailUrl ?? null;
              return (
                <article key={series.id} className={`${ui.card} transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}>
                  <div className="grid gap-4 sm:grid-cols-[minmax(240px,46%)_minmax(0,1fr)] sm:items-start lg:gap-5">
                    <div className="relative shrink-0">
                      <Link href={href} className="block">
                        {seriesCover ? (
                          <Image
                            src={seriesCover}
                            alt={series.title}
                            width={1200}
                            height={675}
                            className="aspect-video w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"
                          />
                        ) : (
                          <div className="aspect-video w-full rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900" />
                        )}
                      </Link>
                      <div className="absolute bottom-2 right-2 z-20">
                        <SessionShareLinkButton
                          sharePath={href}
                          title={`${series.title} · ${studio.name}`}
                          text={`Check out this member zone series: ${series.title}`}
                        />
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                          <Link href={href} className="transition hover:text-teal-700 dark:hover:text-teal-400">
                            {series.title}
                          </Link>
                        </h3>
                        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${accessTag.color}`}>
                          {accessTag.label}
                        </span>
                      </div>
                      {series.summary ? (
                        <p className={`mt-2 line-clamp-3 text-sm ${ui.muted}`}>{series.summary}</p>
                      ) : null}
                      <div className="mt-4">
                        <Link href={href} className={ui.btnPrimarySm}>{ctaLabel}</Link>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>        </section>
      ) : null}

      {shopProducts.length > 0 ? (
        <section id="shop" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className={ui.h2}>{shopTitle}</h2>
            <Link href={studioShopPath(studio.public_slug)} className={`${ui.link} shrink-0`}>
              See all &gt;
            </Link>
          </div>
          <p className={`mt-1 text-sm ${ui.muted}`}>Merchandise available for purchase and delivery.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-2.5">
            {visibleShopProducts.map((product, idx) => (
              <ShopProductCard
                key={product.id}
                href={studioShopProductPath(studio.public_slug, product.share_slug ?? product.id)}
                title={product.title}
                imageUrl={product.image_url}
                price={Number(product.price)}
                currency={String(product.currency ?? "SGD")}
                summary={product.summary}
                outOfStock={product.stock_qty != null && Number(product.stock_qty) < 1}
                priority={idx < 2}
              />
            ))}
          </div>
        </section>
      ) : null}

      {packages.length > 0 ? (
        <section id="packages" className="mx-auto mt-10 w-full max-w-5xl pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={ui.h2}>{packagesTitle}</h2>
            {hiddenPackages.length > 0 ? (
              <Link href={studioPackagesPath(studio.public_slug)} className={ui.link}>
                See {hiddenPackages.length}{" "}more &gt;
              </Link>
            ) : null}
          </div>
          <p className={`mt-1 text-sm ${ui.muted}`}>
            Buy a class pass pack and book any upcoming session.
          </p>
          <div className="mt-4 grid gap-4">
            {visiblePackages.map((pkg) => {
              const buyHref = pkg.share_slug
                ? studioPackagePath(studio.public_slug, pkg.share_slug)
                : null;
              const packageCurrency = String((pkg as { currency?: string | null }).currency ?? "SGD").toUpperCase();
              return (
                <article key={pkg.id} className={`${ui.card} transition-shadow hover:shadow-md hover:border-teal-200 dark:hover:border-teal-800`}>
                  <div className="flex min-w-0 flex-col">
                    <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                      {buyHref ? (
                        <Link href={buyHref} className="transition hover:text-teal-700 dark:hover:text-teal-400">{pkg.name}</Link>
                      ) : pkg.name}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className={`text-sm ${ui.muted}`}>{pkg.credits} class pass{Number(pkg.credits) !== 1 ? "es" : ""}</span>
                      <span className={`text-sm ${ui.muted}`}>· {pkg.expiry_days ? `Expires in ${pkg.expiry_days} days` : "No expiry"}</span>
                    </div>
                    <div className="mt-4 flex items-center gap-4">
                      {buyHref ? <Link href={buyHref} className={ui.btnPrimarySm}>Buy now</Link> : null}
                      {pkg.price != null ? (
                        <span className="text-lg font-bold tabular-nums text-stone-900 dark:text-stone-50">
                          {packageCurrency} {Number(pkg.price).toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>        </section>
      ) : null}
    </main>
  );
}
