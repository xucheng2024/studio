import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { MessageCircle, PlayCircle } from "lucide-react";
import { absolutePlaceholderCoverUrl, isTrustedCoverImageUrl } from "@/lib/coverMedia";
import { isReservedPublicSlug, studioWhatsappLink, toStringArrayJson } from "@/lib/publicStudio";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string }> };

const getPublicStudioData = cache(async (studioSlugRaw: string) => {
  const slug = normalizeStudioSlug(studioSlugRaw ?? "");
  if (!slug || isReservedPublicSlug(slug)) return null;
  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status, public_intro, public_cover_image_url, public_gallery_images, public_video_url, whatsapp_enabled, whatsapp_number_e164, whatsapp_prefill_text")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") return null;

  const { data: services } = await admin
    .from("studio_services")
    .select("id, title, summary, description, price, currency, cover_image_url, gallery_images, video_url, sort_order")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return {
    studio,
    services: services ?? [],
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
  const { studio, services } = data;

  const cover = studio.public_cover_image_url && isTrustedCoverImageUrl(studio.public_cover_image_url)
    ? studio.public_cover_image_url
    : null;
  const gallery = toStringArrayJson(studio.public_gallery_images);
  const waLink = studioWhatsappLink({
    enabled: studio.whatsapp_enabled,
    numberE164: studio.whatsapp_number_e164,
    prefillText: studio.whatsapp_prefill_text,
  });

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
          <p className={ui.badge}>Studio</p>
          <h1 className={`${ui.h1} mt-3`}>{studio.name}</h1>
          <p className={`mt-3 whitespace-pre-wrap ${ui.lead}`}>
            {studio.public_intro?.trim() || "Welcome to our studio. Explore services and get in touch."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {waLink ? (
              <a href={waLink} target="_blank" rel="noreferrer" className={ui.btnPrimary}>
                <MessageCircle size={15} />
                WhatsApp us
              </a>
            ) : null}
            <Link href={`/booking/${studio.public_slug}`} className={ui.btnSecondary}>
              View classes
            </Link>
          </div>
        </div>
      </section>

      {gallery.length > 0 ? (
        <section className="mx-auto mt-10 w-full max-w-5xl">
          <h2 className={ui.h2}>Gallery</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={studio.name} className="aspect-square w-full rounded-xl border border-stone-200 object-cover dark:border-stone-800" />
            ))}
          </div>
        </section>
      ) : null}

      {studio.public_video_url ? (
        <section className="mx-auto mt-10 w-full max-w-5xl">
          <h2 className={ui.h2}>Promo video</h2>
          <div className={`${ui.card} mt-3`}>
            <a href={studio.public_video_url} target="_blank" rel="noreferrer" className={`${ui.link} gap-1.5`}>
              <PlayCircle size={15} />
              Watch studio video
            </a>
          </div>
        </section>
      ) : null}

      <section className="mx-auto mt-10 w-full max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={ui.h2}>Services</h2>
          {waLink ? (
            <a href={waLink} target="_blank" rel="noreferrer" className={ui.btnPrimary}>
              <MessageCircle size={15} />
              Contact on WhatsApp
            </a>
          ) : null}
        </div>
        {services.length === 0 ? (
          <div className={`mt-4 ${ui.emptyState}`}>
            <p className={ui.muted}>No services published yet.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            {services.map((svc) => {
              const serviceGallery = toStringArrayJson(svc.gallery_images);
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
                        <p className="mt-3 text-sm">
                          <a href={svc.video_url} target="_blank" rel="noreferrer" className={`${ui.link} gap-1.5`}>
                            <PlayCircle size={14} />
                            Watch service video
                          </a>
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {serviceGallery.length ? (
                    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {serviceGallery.map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={url} src={url} alt={svc.title} className="aspect-square w-full rounded-md border border-stone-200 object-cover dark:border-stone-800" />
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {waLink ? (
        <section className="mx-auto mt-10 w-full max-w-5xl">
          <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-900/40 dark:bg-teal-950/20">
            <h2 className="text-base font-semibold text-teal-900 dark:text-teal-100">Need help choosing?</h2>
            <p className="mt-1 text-sm text-teal-800 dark:text-teal-200">
              Message us on WhatsApp and we&apos;ll recommend the right service for you.
            </p>
            <a href={waLink} target="_blank" rel="noreferrer" className={`${ui.btnPrimary} mt-3`}>
              <MessageCircle size={15} />
              Chat on WhatsApp
            </a>
          </div>
        </section>
      ) : null}

      <section className="mx-auto mt-10 w-full max-w-5xl pb-4">
        <Link href={`/booking/${studio.public_slug}`} className={ui.linkMuted}>
          View classes and booking page →
        </Link>
      </section>
    </main>
  );
}
