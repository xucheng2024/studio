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
      end_time,
          spots_left,
          guest_price,
          credits_required,
          classes (
            studio_id,
            title,
            studios ( name, public_slug, paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name )
          )
    `,
    )
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true });

  const studioIds = [...new Set((sessions ?? []).map((s) => {
    const cls = s.classes as { studio_id?: string } | null;
    return cls?.studio_id;
  }).filter(Boolean) as string[])];
  const { data: rules } =
    studioIds.length > 0
      ? await supabase
          .from("booking_rules")
          .select(
            "studio_id, location_id, cancel_cutoff_hours, late_cancel_deduct_credit, no_show_deduct_credit, no_show_buffer_min",
          )
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
      <header className="mb-8 flex max-w-2xl flex-col gap-3">
        <h1 className={ui.h1}>Book a class</h1>
        <p className={ui.lead}>
          Pick your class, reserve your seat, and follow the payment steps shown in-app.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {user ? (
            <>
              <span className={ui.badge}>
                {packCredits} credits available
              </span>
              <p className={`w-full text-xs ${ui.muted}`}>
                Auto-apply credits (earliest expiry first). Manual package selection is under Advanced on each
                class.
              </p>
              <Link href="/checkout" className={ui.link}>
                Buy credits
              </Link>
            </>
          ) : (
            <Link href="/auth" className={ui.link}>
              Continue with email
            </Link>
          )}
        </div>
      </header>

      <ul className="flex flex-col gap-4">
        {(sessions ?? []).map((s) => {
          const cls = s.classes as {
            title?: string;
            studio_id?: string;
            studios?:
              | {
                  name?: string;
                  paynow_enabled?: boolean;
                  public_slug?: string | null;
                  paynow_proxy_type?: string | null;
                  paynow_uen?: string | null;
                  paynow_mobile?: string | null;
                  paynow_payee_name?: string | null;
                }
              | {
                  name?: string;
                  public_slug?: string | null;
                  paynow_enabled?: boolean;
                  paynow_proxy_type?: string | null;
                  paynow_uen?: string | null;
                  paynow_mobile?: string | null;
                  paynow_payee_name?: string | null;
                }[];
          } | null;
          const studioRow = Array.isArray(cls?.studios) ? cls?.studios[0] : cls?.studios;
          const title = cls?.title ?? "Class";
          const studio = studioRow?.name ?? "Studio";
          const paynow = getPaynowSummary({
            paynow_enabled: Boolean(studioRow?.paynow_enabled),
            paynow_proxy_type: studioRow?.paynow_proxy_type ?? null,
            paynow_uen: studioRow?.paynow_uen ?? null,
            paynow_mobile: studioRow?.paynow_mobile ?? null,
            paynow_payee_name: studioRow?.paynow_payee_name ?? null,
          });
          const start = new Date(s.start_time).toLocaleString();
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
          const spotsLow = s.spots_left <= 3 && s.spots_left > 0;
          return (
            <li key={s.id} className={ui.card}>
              {/* ── Session info ────────────────────────────── */}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-900 dark:text-stone-100">{title}</p>
                  <p className={`mt-0.5 text-sm ${ui.muted}`}>{studio}</p>
                  <p className={`mt-1 text-sm ${ui.muted}`}>{start}</p>
                </div>
                {/* Spots badge */}
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  s.spots_left === 0
                    ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                    : spotsLow
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                      : "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                }`}>
                  {s.spots_left === 0 ? "Full" : `${s.spots_left} left`}
                </span>
              </div>

              {/* ── Pricing + policy ────────────────────────── */}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                <span>${Number(s.guest_price ?? 0).toFixed(2)} guest</span>
                <span>{creditsRequired} credit{creditsRequired !== 1 ? "s" : ""} member</span>
              </div>
              {scopedRule ? (
                <p className={`mt-1 text-xs ${ui.muted}`}>
                  Cancel ≥{scopedRule.cancel_cutoff_hours ?? 12}h before · Late cancel &amp; no-show may use credit
                </p>
              ) : null}
              {!paynow.configured ? (
                <p className={`mt-1 text-xs ${ui.error}`}>{paynow.line}</p>
              ) : null}

              {/* ── Booking actions ──────────────────────────── */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
                {s.spots_left === 0 ? (
                  <span className={`text-sm ${ui.muted}`}>Class full</span>
                ) : user ? (
                  <>
                    <PackageBookButton sessionId={s.id} packages={userPacks} session={sessionCreditCtx} />
                    {!hasEligiblePack ? (
                      <span className="text-xs text-amber-700 dark:text-amber-300">
                        Not enough credits
                      </span>
                    ) : null}
                    <BookButton sessionId={s.id} disabled={!paynow.configured} />
                  </>
                ) : studioSlug ? (
                  <QuickBookPanel slug={studioSlug} sessionId={s.id} disabled={!paynow.configured} />
                ) : (
                  <span className={`text-xs ${ui.error}`}>Studio booking link unavailable.</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!sessions?.length ? (
        <div className={`mt-8 ${ui.emptyState}`}>
          <p className={`text-sm ${ui.muted}`}>No upcoming sessions yet.</p>
        </div>
      ) : null}
    </main>
  );
}
