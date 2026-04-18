import Link from "next/link";
import { notFound } from "next/navigation";
import { BookButton } from "@/components/BookButton";
import { PackageBookButton } from "@/components/PackageBookButton";
import { QuickBookPanel } from "@/components/QuickBookPanel";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import {
  hasEligiblePackageForSession,
  sumCreditsInStudio,
  type MemberPackageForCredits,
} from "@/lib/memberCredits";
import { getPaynowSummary } from "@/lib/paynow";
import { normalizeStudioSlug } from "@/lib/slug";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ studioSlug: string; classSlug: string }> };

export default async function PublicClassBookingPage({ params }: Props) {
  const { studioSlug: rawStudio, classSlug: rawClass } = await params;
  const studioSlug = normalizeStudioSlug(rawStudio ?? "");
  const classSlug = String(rawClass ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!studioSlug || !/^[a-z0-9-]{6,80}$/.test(classSlug)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: studio } = await supabase
    .from("studios")
    .select(
      "id, name, public_slug, contract_status, paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name",
    )
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const { data: cls } = await supabase
    .from("classes")
    .select("id, title, description, studio_id, is_active, locations ( name )")
    .eq("studio_id", studio.id)
    .eq("share_slug", classSlug)
    .maybeSingle();
  if (!cls || cls.is_active === false) notFound();

  let userPacks: MemberPackageForCredits[] = [];
  let packCredits = 0;
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

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id, start_time, spots_left, guest_price, credits_required, status, location_id")
    .eq("class_id", cls.id)
    .eq("status", "scheduled")
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true });

  const paynow = getPaynowSummary({
    paynow_enabled: Boolean(studio.paynow_enabled),
    paynow_proxy_type: studio.paynow_proxy_type ?? null,
    paynow_uen: studio.paynow_uen ?? null,
    paynow_mobile: studio.paynow_mobile ?? null,
    paynow_payee_name: studio.paynow_payee_name ?? null,
  });

  const loc = cls.locations as { name?: string } | { name?: string }[] | null;
  const locName = Array.isArray(loc) ? loc[0]?.name : loc?.name;

  return (
    <main className={ui.page}>
      <p className={ui.badge}>Shared class</p>
      <h1 className={`${ui.h1} mt-3`}>{cls.title}</h1>
      {cls.description ? (
        <p className={`mt-3 whitespace-pre-wrap text-stone-700 dark:text-stone-300`}>{cls.description}</p>
      ) : null}
      <p className={`mt-4 text-sm ${ui.muted}`}>
        {studio.name}
        {locName ? ` · ${locName}` : ""}
      </p>
      {user ? (
        <p className={`mt-2 text-sm ${ui.muted}`}>{packCredits} credits available at this studio</p>
      ) : (
        <p className={`mt-2 text-sm ${ui.muted}`}>
          <Link href="/auth" className={ui.link}>
            Sign in
          </Link>{" "}
          to book with credits, or book as a guest below.
        </p>
      )}
      <p className={`mt-2 text-xs ${paynow.configured ? ui.muted : ui.error}`}>{paynow.line}</p>

      <h2 className={`${ui.h2} mt-10`}>Upcoming sessions</h2>
      <ul className="mt-4 flex flex-col gap-4">
        {(sessions ?? []).map((s) => {
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
                <p className={`text-sm ${ui.muted}`}>{start}</p>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                  {s.spots_left} spots left
                </p>
                <p className={`mt-1 text-xs ${ui.muted}`}>
                  Guest: ${Number(s.guest_price ?? 0).toFixed(2)} · Member: {creditsRequired} credits
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {user ? (
                  <>
                    <PackageBookButton sessionId={s.id} packages={userPacks} session={sessionCreditCtx} />
                    <BookButton sessionId={s.id} disabled={!paynow.configured} />
                    {!hasEligiblePack ? (
                      <span className="text-right text-xs text-amber-700 dark:text-amber-300">
                        Not enough credits for this class.
                      </span>
                    ) : null}
                  </>
                ) : (
                  <QuickBookPanel slug={studioSlug} sessionId={s.id} disabled={!paynow.configured} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!sessions?.length ? (
        <p className={`mt-6 text-sm ${ui.muted}`}>No upcoming sessions for this class yet.</p>
      ) : null}
    </main>
  );
}
