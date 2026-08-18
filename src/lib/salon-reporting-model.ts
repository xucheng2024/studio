export type MoneyBucket = { gross: number; refunds: number; net: number };

export type AppointmentOutcomeFacts = {
  open: { pending: number; confirmed: number; checked_in: number; in_progress: number };
  closed: { completed: number; cancelled: number; no_show: number };
  by_location: Array<{
    location_id: string | null;
    location_label: string;
    completed: number;
    cancelled: number;
    no_show: number;
  }>;
};

export type SalesFacts = {
  service: MoneyBucket;
  retail: MoneyBucket;
  by_location: Array<{
    location_id: string | null;
    location_label: string;
    service_net: number;
    retail_net: number;
  }>;
  by_service: Array<{ service_id: string | null; service_label: string; gross: number; refunds: number; net: number }>;
  by_product: Array<{ product_id: string | null; product_label: string; gross: number; refunds: number; net: number }>;
  yoy: { current_net: number; prior_net: number };
};

export type CustomerFacts = {
  unique_customers: number;
  visits: number;
  new_customers: number;
  returning_customers: number;
  new_retention: {
    cohort_from: string;
    cohort_to: string;
    window_days: number;
    denominator: number;
    incomplete: number;
    numerator: number;
  };
  repeat_retention: {
    prior_from: string;
    prior_to: string;
    denominator: number;
    numerator: number;
  };
};

export type EmployeeFactsRow = {
  employee_id: string | null;
  employee_label: string;
  completed_services: number;
  net_service_sales: number;
  net_commission: number;
};

export type ReportingFacts = {
  from: string;
  to: string;
  appointment_outcome: AppointmentOutcomeFacts;
  sales: SalesFacts;
  customers: CustomerFacts;
  employees: EmployeeFactsRow[];
};

export function ratio(numerator: number, denominator: number) {
  if (!denominator) return null;
  return numerator / denominator;
}

export function percentLabel(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

export function appointmentRates(closed: AppointmentOutcomeFacts["closed"]) {
  const denominator = closed.completed + closed.cancelled + closed.no_show;
  return {
    fulfilment: ratio(closed.completed, denominator),
    cancellation: ratio(closed.cancelled, denominator),
    noShow: ratio(closed.no_show, denominator),
  };
}

export function fov(visits: number, uniqueCustomers: number) {
  return ratio(visits, uniqueCustomers);
}

export function yoyGrowth(currentNet: number, priorNet: number) {
  return ratio(currentNet - priorNet, priorNet);
}

export function locationCountsMatch(
  total: AppointmentOutcomeFacts["closed"],
  byLocation: AppointmentOutcomeFacts["by_location"],
) {
  const summed = byLocation.reduce(
    (acc, row) => {
      acc.completed += Number(row.completed ?? 0);
      acc.cancelled += Number(row.cancelled ?? 0);
      acc.no_show += Number(row.no_show ?? 0);
      return acc;
    },
    { completed: 0, cancelled: 0, no_show: 0 },
  );
  return (
    summed.completed === Number(total.completed ?? 0)
    && summed.cancelled === Number(total.cancelled ?? 0)
    && summed.no_show === Number(total.no_show ?? 0)
  );
}

export function locationSalesMatch(sales: SalesFacts) {
  const summed = sales.by_location.reduce(
    (acc, row) => {
      acc.service += Number(row.service_net ?? 0);
      acc.retail += Number(row.retail_net ?? 0);
      return acc;
    },
    { service: 0, retail: 0 },
  );
  return summed.service === Number(sales.service.net ?? 0) && summed.retail === Number(sales.retail.net ?? 0);
}

function num(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function bucket(value: unknown): MoneyBucket {
  const row = (value ?? {}) as Record<string, unknown>;
  return { gross: num(row.gross), refunds: num(row.refunds), net: num(row.net) };
}

export function normalizeReportingFacts(raw: unknown): ReportingFacts {
  const row = (raw ?? {}) as Record<string, unknown>;
  const outcome = (row.appointment_outcome ?? {}) as Record<string, unknown>;
  const open = (outcome.open ?? {}) as Record<string, unknown>;
  const closed = (outcome.closed ?? {}) as Record<string, unknown>;
  const sales = (row.sales ?? {}) as Record<string, unknown>;
  const customers = (row.customers ?? {}) as Record<string, unknown>;
  const newRetention = (customers.new_retention ?? {}) as Record<string, unknown>;
  const repeatRetention = (customers.repeat_retention ?? {}) as Record<string, unknown>;
  return {
    from: String(row.from ?? ""),
    to: String(row.to ?? ""),
    appointment_outcome: {
      open: {
        pending: num(open.pending),
        confirmed: num(open.confirmed),
        checked_in: num(open.checked_in),
        in_progress: num(open.in_progress),
      },
      closed: {
        completed: num(closed.completed),
        cancelled: num(closed.cancelled),
        no_show: num(closed.no_show),
      },
      by_location: Array.isArray(outcome.by_location)
        ? outcome.by_location.map((item) => {
          const loc = item as Record<string, unknown>;
          return {
            location_id: loc.location_id ? String(loc.location_id) : null,
            location_label: String(loc.location_label ?? "Unassigned"),
            completed: num(loc.completed),
            cancelled: num(loc.cancelled),
            no_show: num(loc.no_show),
          };
        })
        : [],
    },
    sales: {
      service: bucket(sales.service),
      retail: bucket(sales.retail),
      by_location: Array.isArray(sales.by_location)
        ? sales.by_location.map((item) => {
          const loc = item as Record<string, unknown>;
          return {
            location_id: loc.location_id ? String(loc.location_id) : null,
            location_label: String(loc.location_label ?? "Unassigned"),
            service_net: num(loc.service_net),
            retail_net: num(loc.retail_net),
          };
        })
        : [],
      by_service: Array.isArray(sales.by_service)
        ? sales.by_service.map((item) => {
          const service = item as Record<string, unknown>;
          return {
            service_id: service.service_id ? String(service.service_id) : null,
            service_label: String(service.service_label ?? "Unassigned"),
            gross: num(service.gross),
            refunds: num(service.refunds),
            net: num(service.net),
          };
        })
        : [],
      by_product: Array.isArray(sales.by_product)
        ? sales.by_product.map((item) => {
          const product = item as Record<string, unknown>;
          return {
            product_id: product.product_id ? String(product.product_id) : null,
            product_label: String(product.product_label ?? "Unassigned"),
            gross: num(product.gross),
            refunds: num(product.refunds),
            net: num(product.net),
          };
        })
        : [],
      yoy: {
        current_net: num((sales.yoy as Record<string, unknown> | undefined)?.current_net),
        prior_net: num((sales.yoy as Record<string, unknown> | undefined)?.prior_net),
      },
    },
    customers: {
      unique_customers: num(customers.unique_customers),
      visits: num(customers.visits),
      new_customers: num(customers.new_customers),
      returning_customers: num(customers.returning_customers),
      new_retention: {
        cohort_from: String(newRetention.cohort_from ?? ""),
        cohort_to: String(newRetention.cohort_to ?? ""),
        window_days: num(newRetention.window_days) || 90,
        denominator: num(newRetention.denominator),
        incomplete: num(newRetention.incomplete),
        numerator: num(newRetention.numerator),
      },
      repeat_retention: {
        prior_from: String(repeatRetention.prior_from ?? ""),
        prior_to: String(repeatRetention.prior_to ?? ""),
        denominator: num(repeatRetention.denominator),
        numerator: num(repeatRetention.numerator),
      },
    },
    employees: Array.isArray(row.employees)
      ? row.employees.map((item) => {
        const employee = item as Record<string, unknown>;
        return {
          employee_id: employee.employee_id ? String(employee.employee_id) : null,
          employee_label: String(employee.employee_label ?? "Unassigned"),
          completed_services: num(employee.completed_services),
          net_service_sales: num(employee.net_service_sales),
          net_commission: num(employee.net_commission),
        };
      })
      : [],
  };
}
