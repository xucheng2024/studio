import Image from "next/image";
import Link from "next/link";
import { BookButton } from "@/components/BookButton";
import { PackageBookButton } from "@/components/PackageBookButton";
import { QuickBookPanel } from "@/components/QuickBookPanel";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import {
  hasEligiblePackageForSession,
  sumAllSpendableCredits,
  type MemberPackageForCredits,
} from "@/lib/memberCredits";
import { getPaynowSummary } from "@/lib/paynow";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function BookingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let packCredits = 0;
  let userPacks: MemberPackageForCredits[] = [];
  if (user) {
    await mergeGuestRecordsForUser(user.id, user.email);
    const { data: packs } = await supabase
      .from("client_packages")
      .select("id, credits_left, expiry_date, packages(name, studio_id, location_id)")
      .eq("client_id", user.id)
      .gt("credits_left", 0)
      .or(`expiry_date.is.null,expiry_date.gt.${new Date().toISOString()}`);
    userPacks = ((packs ?? []) as {
      id: string;
      credits_left: number;
      expiry_date: string | null;
      packages?: { name?: string; studio_id?: string; location_id?: string | null } | null;
    }[]).map((p) => {
      const pkg = Array.isArray(p.packages) ? p.packages[0] : p.packages;
      return {
        id: p.id,
        name: pkg?.name ?? "Package",
        credits_left: p.credits_left,
        expiry_date: p.expiry_date,
        studio_id: pkg?.studio_id ?? "",
        location_id: pkg?.location_id ?? null,
      };
    });
    packCredits = sumAllSpendableCredits(userPacks);
  }

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      `
      id,
      location_id,
      start_time,
      spots_left,
      capacity,
      guest_price,
      credits_required,
      classes (
        studio_id,
        title,
        image_url,
        capacity,
        studios ( name, public_slug, paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name )
      )
    `,
    )
    .gte("start_time", new Date().toISOString())
    .eq("status", "scheduled")
    .order("start_time", { ascending: true });

  const studioIds = [...new Set((sessions ?? []).map((s) => {
    const cls = s.classes as { studio_id?: string } | null;
    return cls?.studio_id;
  }).filter(Boolean) as string[])];
  const { data: rules } =
    studioIds.length > 0
      ? await supabase
          .from("booking_rules")
          .select("studio_id, location_id, cancel_cutoff_hours, late_cancel_deduct_credit, no_show_deduct_credit, no_show_buffer_min")
          .in("studio_id", studioIds)
      : { data: [] as const };
  type RuleRow = {
    studio_id: string;
    location_id: string | null;
    cancel_cutoff_hours: number | null;
    late_cancel_deduct_credit: boolean | null;
    no_show_deduct_credit: boolean | null;
    no_show_buffer_min: number | null;
  };
  const ruleMap = new Map<string, RuleRow>();
  for (const r of rules ?? []) {
    ruleMap.set(`${r.studio_id}:${r.location_id ?? "global"}`, r);
  }

  return (
    <main className={ui.page}>
      {/* ── Header ── */}
      <header className="mb-8 max-w-2xl">
        <h1 className={ui.h1}>Upcoming classes</h1>
        <p className={`mt-2 ${ui.lead}`}>
          Pick a session and pay via PayNow — seat held instantly.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {user ? (
            <>
              <span className={ui.badge}>
                {packCredits} credit{packCredits !== 1 ? "s" : ""} available
              </span>
              <Link href="/checkout" className={`text-sm ${ui.link}`}>
                Buy more →
              </Link>
            </>
          ) : (
            <p className={`text-sm ${ui.muted}`}>
              <Link href="/auth" className={ui.link}>Sign in</Link>{" "}
              to book with credits, or book as a guest below.
            </p>
          )}
        </div>
      </header>

      {/* ── Session list ── */}
      <ul className="flex flex-col gap-4 max-w-2xl">
        {(sessions ?? []).map((s) => {
          const cls = s.classes as {
            title?: string;
            studio_id?: string;
            image_url?: string | null;
            capacity?: number | null;
            studios?:
              | { name?: string; public_slug?: string | null; paynow_enabled?: boolean; paynow_proxy_type?: string | null; paynow_uen?: string | null; paynow_mobile?: string | null; paynow_payee_name?: string | null }
              | { name?: string; public_slug?: string | null; paynow_enabled?: boolean; paynow_proxy_type?: string | null; paynow_uen?: string | null; paynow_mobile?: string | null; paynow_payee_name?: string | null }[];
          } | null;
          const studioRow = Array.isArray(cls?.studios) ? cls?.studios[0] : cls?.studios;
          const title = cls?.title ?? "Class";
          const studioName = studioRow?.name ?? null;
          const imageUrl = (cls as { image_url?: string | null } | null)?.image_url ?? null;
          const sessionCapacity = Number((s as { capacity?: number | null }).capacity ?? cls?.capacity ?? 0) || 0;
          const paynow = getPaynowSummary({
            paynow_enabled: Boolean(studioRow?.paynow_enabled),
            paynow_proxy_type: studioRow?.paynow_proxy_type ?? null,
            paynow_uen: studioRow?.paynow_uen ?? null,
            paynow_mobile: studioRow?.paynow_mobile ?? null,
            paynow_payee_name: studioRow?.paynow_payee_name ?? null,
          });
          const dt = new Date(s.start_time);
          const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
          const weekday = dt.toLocaleDateString("en-SG", { weekday: "short" });
          const dayNum = dt.getDate();
          const month = dt.toLocaleDateString("en-SG", { month: "short" });
          const creditsRequired = Number(s.credits_required ?? 1);
          const sessionCreditCtx = {
            studio_id: cls?.studio_id ?? "",
            location_id: s.location_id ?? null,
            credits_required: creditsRequired,
          };
          const hasEligiblePack = hasEligiblePackageForSession(userPacks, sessionCreditCtx);
          const studioSlug = normalizeStudioSlug(studioRow?.public_slug ?? "");
          const scopedRule =
            (cls?.studio_id
              ? ruleMap.get(`${cls.studio_id}:${s.location_id ?? "global"}`) ??
                ruleMap.get(`${cls.studio_id}:global`)
              : null) ?? null;
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
                  {/* Spots badge overlaid on image */}
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
                {/* Date + info row */}
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
                      <p className="font-semibold text-stone-900 dark:text-stone-50 truncate">{title}</p>
                      {studioName ? (
                        <p className={`text-xs ${ui.muted} truncate`}>{studioName}</p>
                      ) : null}
                      <p className="mt-0.5 text-sm font-medium text-stone-700 dark:text-stone-300">{timeLabel}</p>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500 dark:text-stone-400">
                        <span>${Number(s.guest_price ?? 0).toFixed(2)} guest</span>
                        <span>·</span>
                        <span>{creditsRequired} credit{creditsRequired !== 1 ? "s" : ""} member</span>
                      </div>
                    </div>
                  </div>
                  {/* Spots badge (only when no image) */}
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

                {/* Policy hint */}
                {scopedRule ? (
                  <p className={`mt-2 text-xs ${ui.muted}`}>
                    Cancel ≥{scopedRule.cancel_cutoff_hours ?? 12}h before · Late cancel &amp; no-show may use credit
                  </p>
                ) : null}
                {!paynow.configured ? (
                  <p className={`mt-1 text-xs ${ui.error}`}>{paynow.line}</p>
                ) : null}

                {/* Actions */}
                <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                  {spotsLeft === 0 ? (
                    <span className={`text-sm ${ui.muted}`}>This class is full</span>
                  ) : user ? (
                    <div className="flex flex-wrap gap-2">
                      <PackageBookButton sessionId={s.id} packages={userPacks} session={sessionCreditCtx} />
                      <BookButton sessionId={s.id} disabled={!paynow.configured} />
                      {!hasEligiblePack && userPacks.length > 0 ? (
                        <span className="text-xs text-amber-700 dark:text-amber-300">
                          Package not eligible for this class
                        </span>
                      ) : null}
                    </div>
                  ) : studioSlug ? (
                    <QuickBookPanel slug={studioSlug} sessionId={s.id} disabled={!paynow.configured} />
                  ) : (
                    <span className={`text-xs ${ui.error}`}>Studio booking link unavailable.</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!sessions?.length ? (
        <div className={`mt-8 max-w-2xl ${ui.emptyState}`}>
          <p className={`text-sm ${ui.muted}`}>No upcoming sessions yet. Check back soon.</p>
        </div>
      ) : null}
    </main>
  );
}
