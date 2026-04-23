import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { BuyPackageButton } from "@/components/BuyButtons";
import { getPaynowSummary } from "@/lib/paynow";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function CheckoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: packages } = await supabase
    .from("packages")
    .select(
      `
      id,
      name,
      credits,
      price,
      expiry_days,
      image_url,
      studios (
        name,
        paynow_enabled,
        paynow_proxy_type,
        paynow_uen,
        paynow_mobile,
        paynow_payee_name
      )
    `,
    )
    .eq("is_active", true)
    .order("price", { ascending: true });

  return (
    <main className={ui.page}>
      <header className="mb-8 max-w-2xl">
        <p className={ui.badge}>Class packs</p>
        <h1 className={`${ui.h1} mt-2`}>Buy a pack</h1>
        <p className={`${ui.lead} mt-2`}>
          Choose a package, pay with PayNow, and submit your payment receipt for verification.
        </p>
        {!user ? (
          <p className={`mt-3 text-sm ${ui.muted}`}>
            <Link href="/member/auth" className={ui.link}>Sign in</Link>
            {" "}to track purchases and bookings in one place.
          </p>
        ) : null}
      </header>

      <ul className="flex max-w-2xl flex-col gap-4">
        {(packages ?? []).map((p) => {
          const studioObj = (p.studios as
            | {
                name?: string;
                paynow_enabled?: boolean;
                paynow_proxy_type?: string | null;
                paynow_uen?: string | null;
                paynow_mobile?: string | null;
                paynow_payee_name?: string | null;
              }
            | {
                name?: string;
                paynow_enabled?: boolean;
                paynow_proxy_type?: string | null;
                paynow_uen?: string | null;
                paynow_mobile?: string | null;
                paynow_payee_name?: string | null;
              }[]
            | null);
          const studioRow = Array.isArray(studioObj) ? studioObj[0] : studioObj;
          const studio = studioRow?.name ?? "Studio";
          const paynow = getPaynowSummary({
            paynow_enabled: Boolean(studioRow?.paynow_enabled),
            paynow_proxy_type: studioRow?.paynow_proxy_type ?? null,
            paynow_uen: studioRow?.paynow_uen ?? null,
            paynow_mobile: studioRow?.paynow_mobile ?? null,
            paynow_payee_name: studioRow?.paynow_payee_name ?? null,
          });
          const imageUrl = (p as { image_url?: string | null }).image_url ?? null;
          return (
            <li key={p.id} className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white/95 shadow-sm dark:border-stone-800/90 dark:bg-stone-900/70">
              {/* Cover image */}
              {imageUrl ? (
                <div className="relative h-36 w-full sm:h-44">
                  <Image
                    src={imageUrl}
                    alt={p.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 672px"
                  />
                </div>
              ) : null}

              <div className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* ── Left: pack info ── */}
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {!imageUrl ? (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                        <ShoppingBag size={19} />
                      </span>
                    ) : null}
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-900 dark:text-stone-100">{p.name}</p>
                      <p className={`mt-0.5 text-sm ${ui.muted}`}>{studio}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 size={11} className="text-teal-600 dark:text-teal-400" />
                          {p.credits} credits
                        </span>
                        {p.expiry_days != null ? (
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            Expires in {p.expiry_days} days
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            No expiry
                          </span>
                        )}
                      </div>
                      {!paynow.configured ? (
                        <p className={`mt-1.5 flex items-center gap-1 text-xs ${ui.error}`}>
                          <AlertCircle size={11} />
                          {paynow.line}
                        </p>
                      ) : (
                        <p className={`mt-1 text-xs ${ui.muted}`}>{paynow.line}</p>
                      )}
                    </div>
                  </div>

                  {/* ── Right: price + action ── */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="text-lg font-bold tabular-nums text-stone-900 dark:text-stone-100">
                      ${Number(p.price).toFixed(2)}
                    </p>
                    {user ? (
                      <BuyPackageButton packageId={p.id} disabled={!paynow.configured} />
                    ) : (
                      <Link href={`/member/auth?next=/checkout`} className={ui.btnPrimarySm}>
                        Sign in to buy
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {!packages?.length ? (
        <div className={`mt-8 max-w-md ${ui.emptyState}`}>
          <div className={ui.emptyStateIcon}>
            <ShoppingBag size={18} />
          </div>
          <p className="font-medium text-stone-700 dark:text-stone-300">No packages available</p>
          <p className={`text-sm ${ui.muted}`}>Check back soon, or browse classes now.</p>
          <Link href="/booking" className={`${ui.link} text-sm`}>
            Browse classes →
          </Link>
        </div>
      ) : null}
    </main>
  );
}
