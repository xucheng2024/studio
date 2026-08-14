import { createAdminClient } from "@/lib/supabase/admin";

export type DeferredValueRpcRow = {
  studio_id: string;
  customer_id: string;
  package_id: string;
  client_package_id: string;
  as_of: string;
  remaining_credits: number;
  unit_price_snapshot: number;
  deferred_value: number;
  currency: string;
  valuation_source: string;
};

export type DeferredValueDetailRow = DeferredValueRpcRow & {
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  package_name: string;
  package_location_id: string | null;
  package_location_name: string | null;
};

export type DeferredCustomerGroupRow = {
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  row_count: number;
  package_count: number;
  remaining_credits: number;
  deferred_value: number;
  currencies: string[];
};

export type DeferredPackageGroupRow = {
  package_id: string;
  package_name: string;
  location_id: string | null;
  location_name: string | null;
  row_count: number;
  customer_count: number;
  remaining_credits: number;
  deferred_value: number;
  currencies: string[];
};

export async function fetchDeferredValueDetailRows(params: {
  studioId: string;
  locationId?: string | "__unassigned" | null;
  customerId?: string | null;
  packageId?: string | null;
  actorId?: string | null;
  limit?: number;
}) {
  const admin = createAdminClient();
  const { data: rowsRaw } = await admin.rpc("get_pkg01_deferred_value", {
    p_studio_id: params.studioId,
    p_customer_id: null,
    p_package_id: null,
    p_as_of: new Date().toISOString(),
    p_limit: params.limit ?? 5000,
    p_refresh_conflicts: false,
    p_actor_id: params.actorId ?? null,
  });

  const rows = (rowsRaw ?? []) as DeferredValueRpcRow[];
  if (rows.length === 0) return [] as DeferredValueDetailRow[];

  const packageIds = [...new Set(rows.map((row) => row.package_id))];
  const customerIds = [...new Set(rows.map((row) => row.customer_id))];

  const [{ data: packageRows }, { data: customerRows }] = await Promise.all([
    packageIds.length > 0
      ? admin
          .from("packages")
          .select("id, name, location_id")
          .in("id", packageIds)
      : Promise.resolve({ data: [] as const }),
    customerIds.length > 0
      ? admin
          .from("salon_customers")
          .select("id, full_name, email, phone")
          .eq("studio_id", params.studioId)
          .in("id", customerIds)
      : Promise.resolve({ data: [] as const }),
  ]);

  const packageMap = new Map((packageRows ?? []).map((row) => [row.id, row]));
  const customerMap = new Map((customerRows ?? []).map((row) => [row.id, row]));
  const locationIds = [...new Set((packageRows ?? []).map((row) => row.location_id).filter((id): id is string => Boolean(id)))];
  const { data: locationRows } = locationIds.length > 0
    ? await admin
        .from("locations")
        .select("id, name")
        .in("id", locationIds)
    : { data: [] as const };
  const locationMap = new Map((locationRows ?? []).map((row) => [row.id, row.name]));

  return rows
    .filter((row) => {
      if (params.customerId && row.customer_id !== params.customerId) return false;
      if (params.packageId && row.package_id !== params.packageId) return false;

      const pkg = packageMap.get(row.package_id);
      const locationId = pkg?.location_id ?? null;
      if (params.locationId === "__unassigned") return locationId == null;
      if (params.locationId) return locationId === params.locationId;
      return true;
    })
    .map((row) => {
      const pkg = packageMap.get(row.package_id);
      const customer = customerMap.get(row.customer_id);
      return {
        ...row,
        customer_name: customer?.full_name ?? "Unknown customer",
        customer_email: customer?.email ?? null,
        customer_phone: customer?.phone ?? null,
        package_name: pkg?.name ?? "Unknown package",
        package_location_id: pkg?.location_id ?? null,
        package_location_name: pkg?.location_id ? (locationMap.get(pkg.location_id) ?? null) : null,
      } satisfies DeferredValueDetailRow;
    });
}

export function groupDeferredByCustomer(rows: DeferredValueDetailRow[]): DeferredCustomerGroupRow[] {
  const map = new Map<string, DeferredCustomerGroupRow>();

  for (const row of rows) {
    const current = map.get(row.customer_id);
    if (!current) {
      map.set(row.customer_id, {
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        customer_phone: row.customer_phone,
        row_count: 1,
        package_count: 1,
        remaining_credits: Number(row.remaining_credits ?? 0),
        deferred_value: Number(row.deferred_value ?? 0),
        currencies: [row.currency],
      });
      continue;
    }

    current.row_count += 1;
    current.remaining_credits += Number(row.remaining_credits ?? 0);
    current.deferred_value += Number(row.deferred_value ?? 0);
    if (!current.currencies.includes(row.currency)) current.currencies.push(row.currency);
  }

  const packageIdsByCustomer = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!packageIdsByCustomer.has(row.customer_id)) {
      packageIdsByCustomer.set(row.customer_id, new Set());
    }
    packageIdsByCustomer.get(row.customer_id)?.add(row.package_id);
  }

  const result = [...map.values()].map((row) => ({
    ...row,
    package_count: packageIdsByCustomer.get(row.customer_id)?.size ?? row.package_count,
  }));

  return result.sort((a, b) => b.deferred_value - a.deferred_value || a.customer_name.localeCompare(b.customer_name));
}

export function groupDeferredByPackage(rows: DeferredValueDetailRow[]): DeferredPackageGroupRow[] {
  const map = new Map<string, DeferredPackageGroupRow>();

  for (const row of rows) {
    const current = map.get(row.package_id);
    if (!current) {
      map.set(row.package_id, {
        package_id: row.package_id,
        package_name: row.package_name,
        location_id: row.package_location_id,
        location_name: row.package_location_name,
        row_count: 1,
        customer_count: 1,
        remaining_credits: Number(row.remaining_credits ?? 0),
        deferred_value: Number(row.deferred_value ?? 0),
        currencies: [row.currency],
      });
      continue;
    }

    current.row_count += 1;
    current.remaining_credits += Number(row.remaining_credits ?? 0);
    current.deferred_value += Number(row.deferred_value ?? 0);
    if (!current.currencies.includes(row.currency)) current.currencies.push(row.currency);
  }

  const customerIdsByPackage = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!customerIdsByPackage.has(row.package_id)) {
      customerIdsByPackage.set(row.package_id, new Set());
    }
    customerIdsByPackage.get(row.package_id)?.add(row.customer_id);
  }

  const result = [...map.values()].map((row) => ({
    ...row,
    customer_count: customerIdsByPackage.get(row.package_id)?.size ?? row.customer_count,
  }));

  return result.sort((a, b) => b.deferred_value - a.deferred_value || a.package_name.localeCompare(b.package_name));
}

export function filterDeferredRowsByKeyword(rows: DeferredValueDetailRow[], keyword: string) {
  if (!keyword.trim()) return rows;
  const normalized = keyword.trim().toLowerCase();
  return rows.filter((row) =>
    [
      row.customer_name,
      row.customer_email,
      row.customer_phone,
      row.package_name,
      row.currency,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized)));
}
