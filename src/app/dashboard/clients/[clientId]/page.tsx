import { CheckCircle2, Circle } from "lucide-react";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { updateMemberProfile } from "@/app/dashboard/actions";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ location_id?: string; studio_id?: string; member_saved?: string; member_error?: string }>;
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
  if (studioIds.length === 0) {
    return <p className={ui.muted}>Create your first studio in Overview.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to view this member&apos;s ledger.</p>;
  }
  const activeStudioId = selectedStudioId ?? studioIds[0];
  const admin = createAdminClient();

  const { data: clientUser } = await supabase
    .from("users")
    .select("id, email")
    .eq("id", clientId)
    .maybeSingle();
  if (!clientUser) return <p className={ui.muted}>Member not found.</p>;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("full_name, phone, notes")
    .eq("id", clientId)
    .maybeSingle();

  const { data: packRowsRaw } = await supabase
    .from("client_packages")
    .select("id, package_id, credits_left, expiry_date, packages!inner(name, studio_id, location_id, credits)")
    .eq("client_id", clientId)
    .in("packages.studio_id", [activeStudioId]);

  // When a location is selected, only show packages that are either studio-wide
  // (location_id = null) or specifically belong to that location.
  const packRows = selectedLocationId
    ? (packRowsRaw ?? []).filter((r) => {
        const pkg = r.packages as { location_id?: string | null } | { location_id?: string | null }[] | null;
        const locId = Array.isArray(pkg) ? pkg[0]?.location_id : pkg?.location_id;
        return !locId || locId === selectedLocationId;
      })
    : (packRowsRaw ?? []);

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

  const statusColors: Record<string, string> = {
    paid: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/60",
    pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
    failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60",
    refunded: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div>
        <DashboardAppLink href={`/dashboard/clients?${backParams.toString()}`} className={`${ui.btnSecondarySm} mb-3`}>
          ← Member records
        </DashboardAppLink>
        <h1 className={ui.h1}>Package ledger</h1>
        <p className={`mt-1 ${ui.muted}`}>{clientUser.email ?? clientUser.id}</p>
        <div className={`mt-3 inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 dark:border-teal-800/60 dark:bg-teal-950/40`}>
          <span className="text-sm font-semibold text-teal-800 dark:text-teal-200">{balanceTotal}</span>
          <span className={`text-xs ${ui.muted}`}>credits available</span>
        </div>
      </div>

      <section className={ui.card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={ui.h2}>Member profile</h2>
          {sp.member_saved === "1" ? <p className={ui.success}>Saved.</p> : null}
          {sp.member_error ? <p className={ui.error}>Save failed: {sp.member_error}</p> : null}
        </div>
        <form action={updateMemberProfile} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="studio_id" value={activeStudioId} />
          {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
          <input type="hidden" name="client_id" value={clientId} />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Full name</span>
            <input
              name="full_name"
              type="text"
              defaultValue={(profile as { full_name?: string | null } | null)?.full_name ?? ""}
              className={ui.input}
              placeholder="Member name"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Phone</span>
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={(profile as { phone?: string | null } | null)?.phone ?? ""}
              className={ui.input}
              placeholder="+65 9123 4567"
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={ui.label}>Notes</span>
            <textarea
              name="notes"
              defaultValue={(profile as { notes?: string | null } | null)?.notes ?? ""}
              className={ui.input}
              rows={4}
              placeholder="Internal notes for operations (e.g. injury, preference, follow-up)."
              maxLength={1000}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className={ui.btnPrimarySm}>Save profile</button>
          </div>
        </form>
      </section>

      {/* ── Current packages ────────────────────────────────────── */}
      <section>
        <h2 className={ui.h2}>Current packages</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {(packRows ?? []).map((row) => {
            const pkg = Array.isArray(row.packages) ? row.packages[0] : row.packages;
            const pct = pkg?.credits ? Math.round((row.credits_left / Number(pkg.credits)) * 100) : null;
            return (
              <li key={row.id} className={`${ui.card} flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`}>
                <div>
                  <p className="font-semibold text-stone-900 dark:text-stone-100">{pkg?.name ?? "Package"}</p>
                  <p className={`mt-0.5 text-xs ${ui.muted}`}>
                    Expiry: {row.expiry_date ? new Date(row.expiry_date).toLocaleDateString() : "No expiry"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {pct !== null && (
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                      <div
                        className="h-full rounded-full bg-teal-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                    {row.credits_left}
                    <span className={`font-normal ${ui.muted}`}> / {pkg?.credits ?? "?"}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {!packRows?.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No active packages.</p>
          </div>
        ) : null}
      </section>

      {/* ── Package purchases ────────────────────────────────────── */}
      <section>
        <h2 className={ui.h2}>Package purchases</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {purchaseRows.map((p) => {
            const statusCls = statusColors[p.status ?? ""] ?? statusColors.pending;
            return (
              <li key={p.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    ${(Number(p.paid_amount ?? p.amount ?? 0)).toFixed(2)}
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls}`}>
                    {p.status ?? "-"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {p.payment_method ? <span>{p.payment_method}</span> : null}
                  {p.reference_code ? <span>Ref: {p.reference_code}</span> : null}
                  {p.created_at ? <span>{new Date(p.created_at).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {!purchaseRows.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No purchase records.</p>
          </div>
        ) : null}
      </section>

      {/* ── Credit usage ─────────────────────────────────────────── */}
      <section>
        <h2 className={ui.h2}>Credit usage</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {usageRows.map((b) => {
            const sessionObj = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
            const clsObj = Array.isArray(sessionObj?.classes) ? sessionObj?.classes[0] : sessionObj?.classes;
            const checkedIn = Boolean(b.checked_in_at);
            const creditUsed = Boolean(b.credit_consumed_at);
            return (
              <li key={b.id} className="rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {clsObj?.title ?? "Class"}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                    b.status === "booked" || b.status === "attended"
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                      : b.status === "cancelled" || b.status === "no_show"
                        ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  }`}>
                    {b.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {sessionObj?.start_time ? (
                    <span>{new Date(sessionObj.start_time).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</span>
                  ) : null}
                  <span className="flex items-center gap-1">
                    {checkedIn
                      ? <CheckCircle2 size={11} className="text-teal-500" />
                      : <Circle size={11} className="text-stone-400" />}
                    {checkedIn ? "Checked in" : "Not checked in"}
                  </span>
                  <span className="flex items-center gap-1">
                    {creditUsed
                      ? <CheckCircle2 size={11} className="text-teal-500" />
                      : <Circle size={11} className="text-stone-400" />}
                    {creditUsed ? "Credit used" : "Credit pending"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {!usageRows.length ? (
          <div className={`mt-3 ${ui.emptyState}`}>
            <p className={`text-sm ${ui.muted}`}>No package-based bookings yet.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
