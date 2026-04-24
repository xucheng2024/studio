import { getDashboardScope } from "@/lib/dashboard";
import { computeRevenueSummary, revenueByDay, type RevenuePaymentRow } from "@/lib/revenue-summary";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";
import { TrendingUp, RefreshCcw, DollarSign } from "lucide-react";

type Props = {
  searchParams: Promise<{
    location_id?: string;
    studio_id?: string;
    date_from?: string;
    date_to?: string;
  }>;
};

function dayRangeStart(d?: string) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function dayRangeEnd(d?: string) {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
}

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export default async function ReportsPage({ searchParams }: Props) {
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
  if (studioIds.length === 0) return <p className={ui.muted}>Create your first studio in Overview.</p>;
  if (!["owner", "manager"].includes(bestRole(ctx))) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const activeStudioId = selectedStudioId ?? studioIds[0];
  const bounds = monthBounds();
  const dateFrom = sp.date_from ?? bounds.from;
  const dateTo = sp.date_to ?? bounds.to;
  const fromIso = dayRangeStart(dateFrom);
  const toIso = dayRangeEnd(dateTo);

  let revenueQuery = supabase
    .from("payments")
    .select("id, amount, type, payment_method, status, created_at, location_id")
    .in("studio_id", studioIds)
    .in("status", ["paid", "refunded"])
    .order("created_at", { ascending: false })
    .limit(5000);
  if (selectedLocationId) revenueQuery = revenueQuery.eq("location_id", selectedLocationId);
  if (fromIso) revenueQuery = revenueQuery.gte("created_at", fromIso);
  if (toIso) revenueQuery = revenueQuery.lt("created_at", toIso);

  const { data: revenuePaymentsRaw } = await revenueQuery;
  const revenuePayments = (revenuePaymentsRaw ?? []) as RevenuePaymentRow[];
  const summary = computeRevenueSummary(revenuePayments);
  const byDay = revenueByDay(revenuePayments);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Reports</h1>
        <p className={`mt-1 ${ui.muted}`}>
          {selectedLocationId ? "Selected location" : "All locations"} · Revenue uses payment{" "}
          <code className={ui.code}>created_at</code> within the date range (paid + refunded).
        </p>
      </div>

      <div className={`${ui.card} flex flex-col gap-3`}>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "This month", from: bounds.from, to: bounds.to },
            {
              label: "Last 30 days",
              from: (() => {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                return d.toISOString().slice(0, 10);
              })(),
              to: new Date().toISOString().slice(0, 10),
            },
            {
              label: "Last month",
              from: (() => {
                const d = new Date();
                d.setDate(1);
                d.setMonth(d.getMonth() - 1);
                return d.toISOString().slice(0, 10);
              })(),
              to: (() => {
                const d = new Date();
                d.setDate(0);
                return d.toISOString().slice(0, 10);
              })(),
            },
            {
              label: "Last 90 days",
              from: (() => {
                const d = new Date();
                d.setDate(d.getDate() - 90);
                return d.toISOString().slice(0, 10);
              })(),
              to: new Date().toISOString().slice(0, 10),
            },
          ].map(({ label, from, to }) => {
            const isActive = dateFrom === from && dateTo === to;
            const params = new URLSearchParams();
            if (activeStudioId) params.set("studio_id", activeStudioId);
            if (selectedLocationId) params.set("location_id", selectedLocationId);
            params.set("date_from", from);
            params.set("date_to", to);
            return (
              <a
                key={label}
                href={`?${params.toString()}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[32px] inline-flex items-center ${
                  isActive
                    ? "border-teal-400 bg-teal-50 text-teal-800 dark:border-teal-600 dark:bg-teal-950/40 dark:text-teal-300"
                    : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200"
                }`}
              >
                {label}
              </a>
            );
          })}
        </div>

        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {activeStudioId ? <input type="hidden" name="studio_id" value={activeStudioId} /> : null}
          {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>From</span>
              <input type="date" name="date_from" defaultValue={dateFrom} className={`${ui.input} whitespace-nowrap`} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={`${ui.label} whitespace-nowrap`}>To</span>
              <input type="date" name="date_to" defaultValue={dateTo} className={`${ui.input} whitespace-nowrap`} />
            </label>
          </div>
          <button type="submit" className={`${ui.btnPrimarySm} w-full sm:w-auto`}>Apply</button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400">
            <DollarSign size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Gross revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-teal-700 dark:text-teal-300 sm:text-2xl">
              ${summary.gross.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
            <RefreshCcw size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Refunds</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-blue-800 dark:text-blue-200 sm:text-2xl">
              ${summary.refunds.toFixed(2)}
            </p>
          </div>
        </div>
        <div className={`${ui.statCard} flex items-center gap-4`}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <TrendingUp size={18} />
          </span>
          <div>
            <p className={`text-xs font-medium ${ui.muted}`}>Net revenue</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100 sm:text-2xl">
              ${summary.net.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <div className={ui.card}>
        <h2 className={`${ui.h2} text-base`}>Net revenue by day</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>Each row: gross paid, refunds, net for that calendar day.</p>
        <ul className="mt-3 divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {byDay.map((row) => (
            <li key={row.day} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <span className="font-medium tabular-nums text-stone-800 dark:text-stone-200">{row.day}</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                <span className="tabular-nums text-stone-600 dark:text-stone-400">
                  <span className="mr-1 text-xs">Gross</span>${row.gross.toFixed(2)}
                </span>
                <span className="tabular-nums text-stone-500 dark:text-stone-500">
                  <span className="mr-1 text-xs">Ref</span>−${row.refunds.toFixed(2)}
                </span>
                <span className="min-w-20 text-right font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                  ${row.net.toFixed(2)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {!byDay.length ? <p className={`mt-4 text-sm ${ui.muted}`}>No payments in this range.</p> : null}
      </div>
    </div>
  );
}
