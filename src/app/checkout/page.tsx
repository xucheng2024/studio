import Link from "next/link";
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
      is_drop_in,
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
    .order("price", { ascending: true });

  return (
    <main className={ui.page}>
      <header className="mb-8 flex max-w-2xl flex-col gap-2">
        <h1 className={ui.h1}>Buy packs</h1>
        <p className={ui.lead}>
          Choose a package, pay with PayNow, then submit your payment notice for verification.
        </p>
        {!user ? (
          <Link href="/auth" className={`${ui.link} text-sm`}>
            Sign in to buy packages
          </Link>
        ) : null}
      </header>

      <ul className="flex flex-col gap-4">
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
          return (
            <li
              key={p.id}
              className={`${ui.cardInteractive} flex flex-wrap items-center justify-between gap-4`}
            >
              <div>
                <p className="font-medium text-stone-900 dark:text-stone-100">{p.name}</p>
                <p className={`mt-0.5 text-sm ${ui.muted}`}>
                  {studio} · {p.credits} credits · ${p.price}
                  {p.is_drop_in ? " · drop-in template" : ""}
                </p>
                <p className={`mt-1 text-xs ${ui.muted}`}>
                  Expiry:{" "}
                  {p.expiry_days != null ? `${p.expiry_days} days after purchase` : "none"}
                </p>
                <p className={`mt-1 text-xs ${paynow.configured ? ui.muted : ui.error}`}>
                  {paynow.line}
                </p>
              </div>
              {user ? <BuyPackageButton packageId={p.id} disabled={!paynow.configured} /> : null}
            </li>
          );
        })}
      </ul>
      {!packages?.length ? (
        <p className={`mt-6 text-center text-sm ${ui.muted}`}>
          No packages yet. Owners add them in the dashboard.
        </p>
      ) : null}
    </main>
  );
}
