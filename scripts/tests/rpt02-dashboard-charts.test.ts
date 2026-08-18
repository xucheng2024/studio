import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentOutcomeBars,
  employeeProductivityBars,
  normalizeReportingFacts,
  revenueByServiceBars,
  salesTrendBars,
} from "../../src/lib/salon-reporting-model.ts";

const facts = normalizeReportingFacts({
  from: "2026-08-01",
  to: "2026-08-02",
  appointment_outcome: {
    closed: { completed: 3, cancelled: 1, no_show: 1 },
    by_day: [
      { day: "2026-08-01", completed: 2, cancelled: 1, no_show: 0 },
      { day: "2026-08-02", completed: 1, cancelled: 0, no_show: 1 },
    ],
  },
  sales: {
    service: { net: 30 },
    retail: { net: 10 },
    by_service: [{ service_label: "Cut", net: 30 }],
    by_day: [
      { day: "2026-08-01", service_net: 20, retail_net: 10 },
      { day: "2026-08-02", service_net: 10, retail_net: 0 },
    ],
  },
  customers: {},
  employees: [{ employee_label: "Ada", net_service_sales: 30, net_commission: 5 }],
});

test("RPT-02 appointment chart uses daily completed/cancelled/no-show series", () => {
  const bars = appointmentOutcomeBars(facts);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].label, "08-01");
  assert.equal(bars[0].values.Completed, 2);
  assert.equal(bars[1].values["No-show"], 1);
});

test("RPT-02 sales trend and service revenue share the same filter facts", () => {
  assert.deepEqual(salesTrendBars(facts).map((bar) => bar.label), ["08-01", "08-02"]);
  assert.equal(revenueByServiceBars(facts)[0].values.Net, 30);
  assert.equal(employeeProductivityBars(facts)[0].values.Commission, 5);
});
