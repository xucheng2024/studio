import {
  appointmentOutcomeBars,
  employeeProductivityBars,
  revenueByServiceBars,
  salesTrendBars,
  type ChartBar,
  type ReportingFacts,
} from "@/lib/salon-reporting-model";
import { ui } from "@/lib/ui";

const SERIES_COLORS: Record<string, string> = {
  Completed: "#0f766e",
  Cancelled: "#78716c",
  "No-show": "#d97706",
  Service: "#0f766e",
  Retail: "#0891b2",
  Net: "#0f766e",
  Sales: "#0f766e",
  Commission: "#0891b2",
};

function seriesKeys(bars: ChartBar[]) {
  return [...new Set(bars.flatMap((bar) => Object.keys(bar.values)))];
}

function maxTotal(bars: ChartBar[]) {
  return Math.max(1, ...bars.map((bar) => Object.values(bar.values).reduce((sum, value) => sum + Math.max(0, value), 0)));
}

function StackedColumns({ bars, title }: { bars: ChartBar[]; title: string }) {
  const keys = seriesKeys(bars);
  const max = maxTotal(bars);
  const width = Math.max(320, bars.length * 28);
  const height = 180;
  const padX = 16;
  const padY = 16;
  const chartH = height - padY * 2;
  const gap = 6;
  const barW = Math.max(8, (width - padX * 2) / bars.length - gap);
  return (
    <figure className={`${ui.card} flex flex-col gap-3`}>
      <figcaption className={ui.h2}>{title}</figcaption>
      {bars.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label={title}>
          {bars.map((bar, index) => {
            let y = padY + chartH;
            const x = padX + index * ((width - padX * 2) / bars.length);
            return (
              <g key={bar.label}>
                {keys.map((key) => {
                  const value = Math.max(0, bar.values[key] ?? 0);
                  const h = (value / max) * chartH;
                  y -= h;
                  return <rect key={key} x={x} y={y} width={barW} height={h} fill={SERIES_COLORS[key] ?? "#a8a29e"} />;
                })}
                <text x={x + barW / 2} y={height - 4} textAnchor="middle" fontSize="8" fill="#78716c">{bar.label}</text>
              </g>
            );
          })}
        </svg>
      ) : (
        <p className={ui.muted}>No data for this filter.</p>
      )}
      <ul className="flex flex-wrap gap-3 text-xs text-stone-600 dark:text-stone-400">
        {keys.map((key) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: SERIES_COLORS[key] ?? "#a8a29e" }} />
            {key}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function HorizontalBars({ bars, title }: { bars: ChartBar[]; title: string }) {
  const max = Math.max(1, ...bars.map((bar) => Math.max(0, bar.values.Net ?? Object.values(bar.values)[0] ?? 0)));
  return (
    <figure className={`${ui.card} flex flex-col gap-3`}>
      <figcaption className={ui.h2}>{title}</figcaption>
      {bars.length ? (
        <ul className="flex flex-col gap-2">
          {bars.slice(0, 8).map((bar) => {
            const value = Math.max(0, bar.values.Net ?? Object.values(bar.values)[0] ?? 0);
            return (
              <li key={bar.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-sm">
                <span className="truncate text-stone-600 dark:text-stone-400">{bar.label}</span>
                <span className="h-3 rounded-full bg-stone-100 dark:bg-stone-800">
                  <span className="block h-3 rounded-full bg-teal-700" style={{ width: `${(value / max) * 100}%` }} />
                </span>
                <span className="tabular-nums text-stone-700 dark:text-stone-300">{value.toFixed(2)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={ui.muted}>No data for this filter.</p>
      )}
    </figure>
  );
}

function GroupedColumns({ bars, title }: { bars: ChartBar[]; title: string }) {
  const keys = seriesKeys(bars);
  const max = Math.max(1, ...bars.flatMap((bar) => keys.map((key) => Math.max(0, bar.values[key] ?? 0))));
  const width = Math.max(320, bars.length * 40);
  const height = 180;
  const padX = 16;
  const padY = 16;
  const chartH = height - padY * 2;
  const groupW = (width - padX * 2) / Math.max(1, bars.length);
  const barW = Math.max(6, (groupW - 8) / Math.max(1, keys.length));
  return (
    <figure className={`${ui.card} flex flex-col gap-3`}>
      <figcaption className={ui.h2}>{title}</figcaption>
      {bars.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full" role="img" aria-label={title}>
          {bars.map((bar, index) => {
            const x0 = padX + index * groupW;
            return (
              <g key={bar.label}>
                {keys.map((key, keyIndex) => {
                  const value = Math.max(0, bar.values[key] ?? 0);
                  const h = (value / max) * chartH;
                  return (
                    <rect
                      key={key}
                      x={x0 + keyIndex * barW}
                      y={padY + chartH - h}
                      width={barW - 2}
                      height={h}
                      fill={SERIES_COLORS[key] ?? "#a8a29e"}
                    />
                  );
                })}
                <text x={x0 + groupW / 2 - 4} y={height - 4} textAnchor="middle" fontSize="8" fill="#78716c">{bar.label}</text>
              </g>
            );
          })}
        </svg>
      ) : (
        <p className={ui.muted}>No data for this filter.</p>
      )}
      <ul className="flex flex-wrap gap-3 text-xs text-stone-600 dark:text-stone-400">
        {keys.map((key) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: SERIES_COLORS[key] ?? "#a8a29e" }} />
            {key}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function SalonDashboardCharts({ facts }: { facts: ReportingFacts }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className={ui.h2}>Salon dashboard</h2>
        <p className={`mt-1 ${ui.muted}`}>
          Date, location, employee, and service filters apply to all four charts. Inventory and loyalty stay 0.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <StackedColumns title="Appointment outcome" bars={appointmentOutcomeBars(facts)} />
        <StackedColumns title="Sales trend" bars={salesTrendBars(facts)} />
        <HorizontalBars title="Revenue by service" bars={revenueByServiceBars(facts)} />
        <GroupedColumns title="Employee commission / productivity" bars={employeeProductivityBars(facts)} />
      </div>
    </section>
  );
}
