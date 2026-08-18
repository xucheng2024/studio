import {
  appointmentRates,
  fov,
  percentLabel,
  yoyGrowth,
  type ReportingFacts,
} from "@/lib/salon-reporting-model";
import { ui } from "@/lib/ui";

function money(value: number) {
  return `SGD ${value.toFixed(2)}`;
}

function FactTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
  empty: string;
}) {
  if (!rows.length) return <p className={ui.muted}>{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500">
            {headers.map((header) => <th key={header} className="p-3">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-stone-200 dark:border-stone-800">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="p-3">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalonReportingFacts({ facts }: { facts: ReportingFacts }) {
  const rates = appointmentRates(facts.appointment_outcome.closed);
  const visitFov = fov(facts.customers.visits, facts.customers.unique_customers);
  const growth = yoyGrowth(facts.sales.yoy.current_net, facts.sales.yoy.prior_net);
  const newRetentionReady = facts.customers.new_retention.denominator - facts.customers.new_retention.incomplete;
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className={ui.h2}>Salon facts</h2>
        <p className={`mt-1 ${ui.muted}`}>
          Database aggregates for {facts.from} to {facts.to}. Inventory and loyalty stay 0.
        </p>
        {facts.sales.yoy.current_net === 0
          && facts.appointment_outcome.closed.completed
            + facts.appointment_outcome.closed.cancelled
            + facts.appointment_outcome.closed.no_show === 0 ? (
          <p className={`mt-2 text-xs ${ui.muted}`}>
            No closed appointments or paid POS sales in this range. Complete a POS sale or close an appointment, then Apply.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={ui.card}>
          <p className={ui.muted}>Completed</p>
          <p className="mt-1 text-xl font-semibold">{facts.appointment_outcome.closed.completed}</p>
          <p className={`mt-1 text-sm ${ui.muted}`}>Fulfilment {percentLabel(rates.fulfilment)}</p>
        </div>
        <div className={ui.card}>
          <p className={ui.muted}>Net service sales</p>
          <p className="mt-1 text-xl font-semibold">{money(facts.sales.service.net)}</p>
          <p className={`mt-1 text-sm ${ui.muted}`}>YoY {percentLabel(growth)}</p>
        </div>
        <div className={ui.card}>
          <p className={ui.muted}>Unique customers</p>
          <p className="mt-1 text-xl font-semibold">{facts.customers.unique_customers}</p>
          <p className={`mt-1 text-sm ${ui.muted}`}>FOV {visitFov == null ? "N/A" : visitFov.toFixed(2)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={ui.h2}>Appointment outcome</h3>
        <FactTable
          headers={["Location", "Completed", "Cancelled", "No-show"]}
          empty="No closed salon appointments in this range."
          rows={facts.appointment_outcome.by_location.map((row) => [
            row.location_label,
            row.completed,
            row.cancelled,
            row.no_show,
          ])}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={ui.h2}>Outlet / service / retail sales</h3>
        <FactTable
          headers={["Location", "Service net", "Retail net"]}
          empty="No paid salon POS sales in this range."
          rows={facts.sales.by_location.map((row) => [row.location_label, money(row.service_net), money(row.retail_net)])}
        />
        <FactTable
          headers={["Service", "Gross", "Refunds", "Net"]}
          empty="No service sales in this range."
          rows={facts.sales.by_service.map((row) => [row.service_label, money(row.gross), money(row.refunds), money(row.net)])}
        />
        <FactTable
          headers={["Retail product", "Gross", "Refunds", "Net"]}
          empty="No retail sales in this range."
          rows={facts.sales.by_product.map((row) => [row.product_label, money(row.gross), money(row.refunds), money(row.net)])}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={ui.h2}>Customers</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className={ui.muted}>New customers</dt><dd>{facts.customers.new_customers}</dd></div>
          <div><dt className={ui.muted}>Returning customers</dt><dd>{facts.customers.returning_customers}</dd></div>
          <div>
            <dt className={ui.muted}>New client retention (90 days)</dt>
            <dd>
              {facts.customers.new_retention.numerator}/{newRetentionReady}
              {facts.customers.new_retention.incomplete ? ` · ${facts.customers.new_retention.incomplete} incomplete` : ""}
            </dd>
          </div>
          <div>
            <dt className={ui.muted}>Repeat client retention</dt>
            <dd>
              {facts.customers.repeat_retention.numerator}/{facts.customers.repeat_retention.denominator}
              {facts.customers.repeat_retention.prior_from ? ` · prior ${facts.customers.repeat_retention.prior_from} to ${facts.customers.repeat_retention.prior_to}` : ""}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={ui.h2}>Employee productivity</h3>
        <FactTable
          headers={["Employee", "Completed services", "Net service sales", "Net commission"]}
          empty="No employee productivity in this range."
          rows={facts.employees.map((row) => [
            row.employee_label,
            row.completed_services,
            money(row.net_service_sales),
            money(row.net_commission),
          ])}
        />
      </div>
    </section>
  );
}
