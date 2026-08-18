import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentRates,
  fov,
  locationCountsMatch,
  locationSalesMatch,
  normalizeReportingFacts,
  percentLabel,
  yoyGrowth,
} from "../../src/lib/salon-reporting-model.ts";

test("RPT-01 fulfilment uses closed appointments only and N/A when the denominator is 0", () => {
  assert.deepEqual(appointmentRates({ completed: 8, cancelled: 1, no_show: 1 }), {
    fulfilment: 0.8,
    cancellation: 0.1,
    noShow: 0.1,
  });
  assert.equal(percentLabel(appointmentRates({ completed: 0, cancelled: 0, no_show: 0 }).fulfilment), "N/A");
});

test("RPT-01 FOV is completed visits divided by unique customers", () => {
  assert.equal(fov(10, 4), 2.5);
  assert.equal(fov(0, 0), null);
});

test("RPT-01 YoY is N/A when the prior period net is 0", () => {
  assert.equal(yoyGrowth(120, 100), 0.2);
  assert.equal(percentLabel(yoyGrowth(50, 0)), "N/A");
});

test("RPT-01 location rows sum to the All locations totals", () => {
  assert.equal(locationCountsMatch(
    { completed: 5, cancelled: 2, no_show: 1 },
    [
      { location_id: "a", location_label: "A", completed: 3, cancelled: 2, no_show: 0 },
      { location_id: null, location_label: "Unassigned", completed: 2, cancelled: 0, no_show: 1 },
    ],
  ), true);
  assert.equal(locationSalesMatch({
    service: { gross: 10, refunds: 1, net: 9 },
    retail: { gross: 4, refunds: 0, net: 4 },
    by_location: [
      { location_id: "a", location_label: "A", service_net: 9, retail_net: 1 },
      { location_id: null, location_label: "Unassigned", service_net: 0, retail_net: 3 },
    ],
    by_service: [],
    by_product: [],
    by_day: [],
    yoy: { current_net: 13, prior_net: 10 },
  }), true);
});

test("RPT-01 keeps unassigned labels and numeric buckets from raw RPC json", () => {
  const facts = normalizeReportingFacts({
    from: "2026-08-01",
    to: "2026-08-31",
    appointment_outcome: { closed: { completed: "2" }, by_location: [{ location_label: "Unassigned", completed: "2" }] },
    sales: { service: { net: "15.5" }, yoy: { current_net: "15.5", prior_net: "0" } },
    customers: { unique_customers: 1, visits: 2, new_retention: { incomplete: 1 }, repeat_retention: {} },
    employees: [{ employee_label: "Unassigned", completed_services: 2 }],
  });
  assert.equal(facts.appointment_outcome.by_location[0].location_label, "Unassigned");
  assert.equal(facts.sales.service.net, 15.5);
  assert.equal(facts.customers.new_retention.incomplete, 1);
  assert.equal(facts.employees[0].employee_label, "Unassigned");
});
