import Link from "next/link";
import { notFound } from "next/navigation";
import { BookButton } from "@/components/BookButton";
import { PackageBookButton } from "@/components/PackageBookButton";
import { QuickBookPanel } from "@/components/QuickBookPanel";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import { hasEligiblePackageForSession, sumCreditsInStudio, type MemberPackageForCredits } from "@/lib/memberCredits";
import { getPaynowSummary } from "@/lib/paynow";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ slug: string }> };

export default async function StudioBookingPage({ params }: Props) {
  const { slug: raw } = await params;
  const slug = normalizeStudioSlug(raw);
  if (!slug) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: studio, error: stErr } = await supabase
    .from("studios")
    .select("id, name, public_slug")
    .eq("public_slug", slug)
    .maybeSingle();

  if (stErr || !studio) {
    notFound();
  }
  const { data: studioPaynow } = await supabase
    .from("studios")
    .select("paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name")
    .eq("id", studio.id)
    .maybeSingle();
  const paynow = getPaynowSummary({
    paynow_enabled: Boolean(studioPaynow?.paynow_enabled),
    paynow_proxy_type: studioPaynow?.paynow_proxy_type ?? null,
    paynow_uen: studioPaynow?.paynow_uen ?? null,
    paynow_mobile: studioPaynow?.paynow_mobile ?? null,
    paynow_payee_name: studioPaynow?.paynow_payee_name ?? null,
  });

  let packCredits = 0;
  let userPacks: MemberPackageForCredits[] = [];
  if (user) {
    await mergeGuestRecordsForUser(user.id, user.email);
    const { data: packs } = await supabase
      .from("client_packages")
      .select("id, credits_left, expiry_date, packages!inner(name, studio_id, location_id)")
      .eq("client_id", user.id)
      .eq("packages.studio_id", studio.id)
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
        studio_id: pkg?.studio_id ?? studio.id,
        location_id: pkg?.location_id ?? null,
      };
    });
    packCredits = sumCreditsInStudio(userPacks, studio.id);
  }

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
            `
          id,
          location_id,
          start_time,
          end_time,
          spots_left,
          guest_price,
          credits_required,
          classes!inner ( title, studio_id )
        `,
          )
          .in("class_id", classIds)
          .eq("classes.studio_id", studio.id)
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
      <header className="mb-8 flex max-w-2xl flex-col gap-3">
        <p className={ui.badge}>Studio page</p>
        <h1 className={ui.h1}>{studio.name}</h1>
        <p className={ui.lead}>Pick a session and reserve your seat. Guests can book without creating an account.</p>
        <p className={`text-sm ${ui.muted}`}>
          Policy: cancel at least {rules?.cancel_cutoff_hours ?? 12}h before class for free. Late cancel{" "}
          {rules?.late_cancel_deduct_credit ?? true ? "uses" : "does not use"} a credit. No-show after{" "}
          {rules?.no_show_buffer_min ?? 15} minutes{" "}
          {rules?.no_show_deduct_credit ?? true ? "uses" : "does not use"} a credit.
        </p>
        <p className={`text-sm ${paynow.configured ? ui.muted : ui.error}`}>{paynow.line}</p>
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
            <span className={ui.lead}>
              Book as guest below, or{" "}
              <Link href="/auth" className={ui.link}>
                sign in with email
              </Link>
              to manage your bookings.
            </span>
          )}
        </div>
      </header>

      <ul className="flex flex-col gap-4">
        {(sessions ?? []).map((s) => {
          const cls = s.classes as { title?: string } | null;
          const title = cls?.title ?? "Class";
          const start = new Date(s.start_time).toLocaleString();
          const creditsRequired = Number(s.credits_required ?? 1);
          const sessionCreditCtx = {
            studio_id: studio.id,
            location_id: s.location_id ?? null,
            credits_required: creditsRequired,
          };
          const hasEligiblePack = hasEligiblePackageForSession(userPacks, sessionCreditCtx);
          return (
            <li
              key={s.id}
              className={`${ui.cardInteractive} flex flex-wrap items-start justify-between gap-4`}
            >
              <div>
                <p className="font-medium text-stone-900 dark:text-stone-100">{title}</p>
                <p className={`mt-0.5 text-sm ${ui.muted}`}>{start}</p>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                  {s.spots_left} spots left
                </p>
                <p className={`mt-1 text-xs ${ui.muted}`}>
                  Guest: ${Number(s.guest_price ?? 0).toFixed(2)} · Member: {creditsRequired} credits
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {user ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <PackageBookButton sessionId={s.id} packages={userPacks} session={sessionCreditCtx} />
                    <BookButton sessionId={s.id} disabled={!paynow.configured} />
                    {!hasEligiblePack ? (
                      <span className="w-full text-right text-xs text-amber-700 dark:text-amber-300">
                        Not enough credits for this class.
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <QuickBookPanel slug={slug} sessionId={s.id} disabled={!paynow.configured} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!sessions?.length ? (
        <p className={`mt-6 text-center text-sm ${ui.muted}`}>No upcoming sessions yet.</p>
      ) : null}
    </main>
  );
}
