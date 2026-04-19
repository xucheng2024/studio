import { DashboardAppLink } from "@/components/DashboardAppLink";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ location_id?: string; studio_id?: string }>;
};

export default async function ClientLedgerPage({ params, searchParams }: Props) {
  const { clientId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  if (!["owner", "manager", "frontdesk"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  const activeStudioId = selectedStudioId ?? studioIds[0];

  const { data: clientUser } = await supabase
    .from("users")
    .select("id, email")
    .eq("id", clientId)
    .maybeSingle();
  if (!clientUser) return <p className={ui.muted}>Member not found.</p>;

  let packQ = supabase
    .from("client_packages")
    .select("id, package_id, credits_left, expiry_date, packages!inner(name, studio_id, location_id, credits)")
    .eq("client_id", clientId)
    .in("packages.studio_id", [activeStudioId]);
  const { data: packRows } = await packQ;

  let payQ = supabase
    .from("payments")
    .select("id, package_id, amount, paid_amount, status, type, payment_method, reference_code, created_at")
    .eq("client_id", clientId)
    .eq("studio_id", activeStudioId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (selectedLocationId) payQ = payQ.eq("location_id", selectedLocationId);
  const { data: paymentRows } = await payQ;

  let bookingQ = supabase
    .from("bookings")
    .select(
      "id, status, created_at, checked_in_at, credit_consumed_at, client_package_id, class_sessions!inner(start_time, classes!inner(title, studio_id))",
    )
    .eq("client_id", clientId)
    .in("class_sessions.classes.studio_id", [activeStudioId])
    .order("created_at", { ascending: false })
    .limit(400);
  if (selectedLocationId) bookingQ = bookingQ.eq("class_sessions.location_id", selectedLocationId);
  const { data: bookingRows } = await bookingQ;

  const balanceTotal = (packRows ?? []).reduce((sum, row) => sum + Number(row.credits_left ?? 0), 0);
  const purchaseRows = (paymentRows ?? []).filter((p) => p.type === "package");
  const usageRows = (bookingRows ?? []).filter((b) => Boolean(b.client_package_id));

  const backParams = new URLSearchParams();
  backParams.set("studio_id", activeStudioId);
  if (selectedLocationId) backParams.set("location_id", selectedLocationId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Member package ledger</h1>
        <p className={`${ui.muted} mt-1`}>Member: {clientUser.email ?? clientUser.id}</p>
        <p className={`${ui.muted} text-sm`}>Current credits balance: {balanceTotal}</p>
        <div className="mt-3">
          <DashboardAppLink href={`/dashboard/clients?${backParams.toString()}`} className={ui.btnSecondarySm}>
            Back to member records
          </DashboardAppLink>
        </div>
      </div>

      <section className={ui.card}>
        <h2 className={ui.h2}>Current packages</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(packRows ?? []).map((row) => {
            const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages;
            return (
              <li key={row.id} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-700">
                <p className="font-medium text-stone-900 dark:text-stone-100">{pkg?.name ?? "Package"}</p>
                <p className={ui.muted}>
                  Credits left: {row.credits_left} / {pkg?.credits ?? "-"} · Expiry:{" "}
                  {row.expiry_date ? new Date(row.expiry_date).toLocaleString() : "No expiry"}
                </p>
              </li>
            );
          })}
        </ul>
        {!packRows?.length ? <p className={`mt-3 text-sm ${ui.muted}`}>No package balance records.</p> : null}
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Package purchases</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {purchaseRows.map((p) => (
            <li key={p.id} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-700">
              <p className="font-medium text-stone-900 dark:text-stone-100">
                {p.status.toUpperCase()} · ${(Number(p.paid_amount ?? p.amount ?? 0)).toFixed(2)}
              </p>
              <p className={ui.muted}>
                {p.payment_method ?? "-"} · Ref {p.reference_code ?? "-"} ·{" "}
                {p.created_at ? new Date(p.created_at).toLocaleString() : "-"}
              </p>
            </li>
          ))}
        </ul>
        {!purchaseRows.length ? <p className={`mt-3 text-sm ${ui.muted}`}>No package purchase records.</p> : null}
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Credit usage (bookings with package)</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {usageRows.map((b) => {
            const sessionObj = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
            const clsObj = Array.isArray(sessionObj?.classes) ? sessionObj?.classes[0] : sessionObj?.classes;
            return (
              <li key={b.id} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-700">
                <p className="font-medium text-stone-900 dark:text-stone-100">
                  {clsObj?.title ?? "Class"} · {sessionObj?.start_time ? new Date(sessionObj.start_time).toLocaleString() : "-"}
                </p>
                <p className={ui.muted}>
                  Booking {b.status} · Checked in: {b.checked_in_at ? new Date(b.checked_in_at).toLocaleString() : "No"} ·
                  Credit consumed: {b.credit_consumed_at ? new Date(b.credit_consumed_at).toLocaleString() : "No"}
                </p>
              </li>
            );
          })}
        </ul>
        {!usageRows.length ? <p className={`mt-3 text-sm ${ui.muted}`}>No package-based booking records.</p> : null}
      </section>
    </div>
  );
}
