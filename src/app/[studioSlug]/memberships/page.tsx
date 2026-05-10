import Link from "next/link";
import { notFound } from "next/navigation";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { isReservedPublicSlug } from "@/lib/publicStudio";
import { studioHomePath, studioMembershipPath } from "@/lib/public-paths";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string }> };

export default async function PublicMembershipsPage({ params }: Props) {
  const { studioSlug: rawSlug } = await params;
  const studioSlug = normalizeStudioSlug(rawSlug);
  if (!studioSlug || isReservedPublicSlug(studioSlug)) notFound();

  const admin = createAdminClient();
  const { data: studio } = await admin
    .from("studios")
    .select("id, name, public_slug, contract_status")
    .eq("public_slug", studioSlug)
    .maybeSingle();
  if (!studio || studio.contract_status === "suspended") notFound();

  const { data: memberships } = await admin
    .from("membership_products")
    .select("id, name, description, price, currency, billing_interval, trial_days, share_slug")
    .eq("studio_id", studio.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .not("share_slug", "is", null)
    .order("price", { ascending: true });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-4 sm:px-6 lg:px-8">
      <StudioPublicBackNav href={studioHomePath(studio.public_slug)}>Back to studio</StudioPublicBackNav>
      <div className="mt-4">
        <h1 className={ui.h1}>Memberships</h1>
        <p className={`mt-1 ${ui.muted}`}>Choose a plan for recurring access and member benefits.</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {(memberships ?? []).map((m) => {
          const href = m.share_slug ? studioMembershipPath(studio.public_slug, m.share_slug) : null;
          const currency = String(m.currency ?? "SGD").toUpperCase();
          const intervalLabel = m.billing_interval === "yearly" ? "year" : "month";
          const trialDays = Number(m.trial_days ?? 0);
          return (
            <article key={m.id} className={`${ui.card} flex flex-col`}>
              <div className="flex flex-1 flex-col">
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {href ? (
                    <Link href={href} className="transition hover:text-teal-700 dark:hover:text-teal-400">
                      {m.name}
                    </Link>
                  ) : (
                    m.name
                  )}
                </h2>
                {m.description ? (
                  <p className={`mt-2 line-clamp-3 whitespace-pre-wrap text-sm ${ui.muted}`}>{m.description}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                  {trialDays > 0 ? (
                    <span className={`text-sm ${ui.muted}`}>{trialDays}-day trial</span>
                  ) : (
                    <span className={`text-sm ${ui.muted}`}>Recurring billing</span>
                  )}
                  <span className={`text-sm ${ui.muted}`}>· Billed per {intervalLabel}</span>
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  {m.price != null ? (
                    <span className="text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                      {currency} {Number(m.price).toFixed(2)}
                      <span className={`ml-1 text-sm font-normal ${ui.muted}`}>/ {intervalLabel}</span>
                    </span>
                  ) : null}
                  {href ? (
                    <Link href={href} className={ui.btnPrimary}>
                      View plan
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {(memberships ?? []).length === 0 ? (
        <p className={`mt-6 text-sm ${ui.muted}`}>No membership plans are available yet.</p>
      ) : null}
    </main>
  );
}
