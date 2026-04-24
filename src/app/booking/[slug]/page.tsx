import Image from "next/image";
import { notFound } from "next/navigation";
import { QuickBookPanel } from "@/components/QuickBookPanel";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ slug: string }> };

export default async function StudioBookingPage({ params }: Props) {
  const { slug: raw } = await params;
  const slug = normalizeStudioSlug(raw);
  if (!slug) notFound();

  const supabase = await createClient();
  const studioRes = await supabase
    .from("studios")
    .select("id, name, public_slug, hitpay_enabled")
    .eq("public_slug", slug)
    .maybeSingle();
  const { data: studio, error: stErr } = studioRes;
  if (stErr || !studio) notFound();
  const paymentReady = Boolean(studio.hitpay_enabled);

  const { data: classes } = await supabase
    .from("classes")
    .select("id")
    .eq("studio_id", studio.id);
  const classIds = (classes ?? []).map((c) => c.id);

  const { data: sessions } =
    classIds.length > 0
      ? await supabase
          .from("class_sessions")
          .select(
            `id, location_id, start_time, spots_left, capacity, guest_price, credits_required,
             classes!inner ( title, studio_id, image_url, capacity )`,
          )
          .in("class_id", classIds)
          .eq("status", "scheduled")
          .gte("start_time", new Date().toISOString())
          .order("start_time", { ascending: true })
      : { data: [] as const };

  const firstLocationId = (sessions?.[0] as { location_id?: string } | undefined)?.location_id ?? null;
  const rulesQuery = supabase
    .from("booking_rules")
    .select("cancel_cutoff_hours, late_cancel_deduct_credit, no_show_deduct_credit, no_show_buffer_min")
    .eq("studio_id", studio.id)
    .limit(1);
  const { data: rules } = firstLocationId
    ? await rulesQuery.eq("location_id", firstLocationId).maybeSingle()
    : await rulesQuery.is("location_id", null).maybeSingle();

  return (
    <main className={ui.page}>
      {/* ── Studio header ── */}
      <header className="mb-8 max-w-2xl">
        <p className={ui.badge}>{studio.name}</p>
        <h1 className={`${ui.h1} mt-3`}>Book a class</h1>
        <p className={`mt-2 ${ui.lead}`}>
          Pick a session and continue to secure checkout.
        </p>

        {/* Policy summary */}
        {rules ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>
            Free cancellation ≥{rules.cancel_cutoff_hours ?? 12}h before class ·
            Late cancel {rules.late_cancel_deduct_credit ? "uses" : "does not use"} a class pass ·
            No-show after {rules.no_show_buffer_min ?? 15} min {rules.no_show_deduct_credit ? "uses" : "does not use"} a class pass
          </p>
        ) : null}

        {!paymentReady ? (
          <p className={`mt-2 text-xs ${ui.error}`}>Online payment is not configured for this deployment.</p>
        ) : null}

      </header>

      {/* ── Session list ── */}
      <ul className="flex flex-col gap-4 max-w-2xl">
        {(sessions ?? []).map((s) => {
          const cls = s.classes as { title?: string; studio_id?: string; image_url?: string | null; capacity?: number | null } | null;
          const title = cls?.title ?? "Class";
          const imageUrl = cls?.image_url ?? null;
          const sessionCapacity = Number((s as { capacity?: number | null }).capacity ?? cls?.capacity ?? 0) || 0;
          const dt = new Date(s.start_time);
          const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
          const weekday = dt.toLocaleDateString("en-SG", { weekday: "short" });
          const dayNum = dt.getDate();
          const month = dt.toLocaleDateString("en-SG", { month: "short" });
          const creditsRequired = Number(s.credits_required ?? 1);
          const spotsLeft = Number(s.spots_left ?? 0);
          const spotsLow = spotsLeft > 0 && spotsLeft <= 3;
          const spotsText = spotsLeft === 0
            ? sessionCapacity > 0 ? `Full · 0 / ${sessionCapacity}` : "Full"
            : sessionCapacity > 0
              ? `${spotsLeft} / ${sessionCapacity} left`
              : spotsLow ? `${spotsLeft} left` : `${spotsLeft} spots`;

          return (
            <li key={s.id} className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white/95 shadow-sm dark:border-stone-800/90 dark:bg-stone-900/70">
              {/* Cover image */}
              {imageUrl ? (
                <div className="relative h-44 w-full sm:h-52">
                  <Image
                    src={imageUrl}
                    alt={title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 672px"
                  />
                  <span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${
                    spotsLeft === 0
                      ? "bg-red-600/85 text-white"
                      : spotsLow
                        ? "bg-amber-500/85 text-white"
                        : "bg-teal-600/85 text-white"
                  }`}>
                    {spotsText}
                  </span>
                </div>
              ) : null}

              <div className="p-4">
                {/* Date + info */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* Calendar block */}
                    <div className="flex w-12 shrink-0 flex-col items-center rounded-xl border border-stone-200 bg-stone-50 py-1 dark:border-stone-700 dark:bg-stone-800">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        {weekday}
                      </span>
                      <span className="text-lg font-bold leading-tight text-stone-900 dark:text-stone-50">
                        {dayNum}
                      </span>
                      <span className="text-[10px] text-stone-500 dark:text-stone-400">
                        {month}
                      </span>
                    </div>
                    {/* Title + time + price */}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-stone-900 dark:text-stone-50">{title}</p>
                      <p className="mt-0.5 text-sm font-medium text-stone-700 dark:text-stone-300">{timeLabel}</p>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500 dark:text-stone-400">
                        <span>${Number(s.guest_price ?? 0).toFixed(2)} guest</span>
                        <span>·</span>
                        <span>{creditsRequired} class pass{creditsRequired !== 1 ? "s" : ""} member</span>
                      </div>
                    </div>
                  </div>
                  {/* Spots badge (no image) */}
                  {!imageUrl ? (
                    <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      spotsLeft === 0
                        ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                        : spotsLow
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                    }`}>
                      {spotsText}
                    </span>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                  {spotsLeft === 0 ? (
                    <span className={`text-sm ${ui.muted}`}>This class is full</span>
                  ) : (
                    <QuickBookPanel slug={slug} sessionId={s.id} disabled={!paymentReady} />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!sessions?.length ? (
        <div className={`mt-6 max-w-2xl ${ui.emptyState}`}>
          <p className={`text-sm ${ui.muted}`}>No upcoming sessions yet. Check back soon.</p>
        </div>
      ) : null}
    </main>
  );
}
