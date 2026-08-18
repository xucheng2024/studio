import "server-only";

import { dayRangeEndExclusiveIso, dayRangeStartIso } from "@/lib/date";
import {
  customerExportTable,
  filterCustomerExportRows,
  packageExportTable,
  saleExportTable,
  type CustomerExportSource,
  type PackageExportSource,
  type SaleExportSource,
} from "@/lib/business-export-model";
import { revenueEffectiveTimestamp } from "@/lib/revenue-summary";
import { listSalonCustomersForDashboard } from "@/lib/salon-customer-sensitive";
import { createAdminClient } from "@/lib/supabase/admin";

export async function buildCustomerExportTable(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
  q?: string;
  status?: string;
}) {
  const listResult = await listSalonCustomersForDashboard({
    userId: params.userId,
    email: params.email ?? null,
    studioId: params.studioId,
    locationId: params.locationId ?? null,
  });
  if (!listResult.ok) return listResult;
  const customers: CustomerExportSource[] = listResult.customers.map((customer) => ({
    id: customer.id,
    full_name: customer.full_name,
    email: customer.email,
    phone: customer.phone,
    status: customer.status,
    preferred_location_id: customer.preferred_location_id,
    source: customer.source,
    created_at: customer.created_at,
  }));
  return {
    ok: true as const,
    table: customerExportTable(filterCustomerExportRows(customers, { q: params.q, status: params.status })),
  };
}

export async function buildPackageExportTable(params: {
  studioIds: string[];
  locationId?: string | null;
}) {
  const admin = createAdminClient();
  let query = admin
    .from("packages")
    .select("id, name, credits, price, expiry_days, location_id, is_active")
    .in("studio_id", params.studioIds)
    .is("deleted_at", null)
    .order("price");
  if (params.locationId) query = query.eq("location_id", params.locationId);
  const { data, error } = await query;
  if (error) throw error;
  return packageExportTable((data ?? []) as PackageExportSource[]);
}

export async function buildSaleExportTable(params: {
  studioId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  locationId?: string | null;
  unassigned?: boolean;
  employeeId?: string | null;
  serviceId?: string | null;
  source?: string | null;
  salesChannel?: string | null;
  exportCap: number;
}) {
  const admin = createAdminClient();
  const fromIso = dayRangeStartIso(params.dateFrom);
  const toIso = dayRangeEndExclusiveIso(params.dateTo);
  let paymentQuery = admin
    .from("payments")
    .select("id, pos_sale_id, status, source, sales_channel, location_id, created_at, paid_at, verified_at, refunded_at")
    .eq("studio_id", params.studioId)
    .in("status", ["paid", "refunded"])
    .not("pos_sale_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(params.exportCap + 1);
  if (params.unassigned) paymentQuery = paymentQuery.is("location_id", null);
  else if (params.locationId) paymentQuery = paymentQuery.eq("location_id", params.locationId);
  if (params.source) paymentQuery = paymentQuery.eq("source", params.source);
  if (params.salesChannel) paymentQuery = paymentQuery.eq("sales_channel", params.salesChannel);
  const { data: payments, error: paymentError } = await paymentQuery;
  if (paymentError) throw paymentError;

  const inRange = (payments ?? []).filter((row) => {
    const effectiveAt = revenueEffectiveTimestamp(row);
    if (!effectiveAt) return false;
    if (fromIso && effectiveAt < fromIso) return false;
    if (toIso && effectiveAt >= toIso) return false;
    return true;
  });
  const paymentBySale = new Map<string, (typeof inRange)[number]>();
  for (const payment of inRange) {
    if (!payment.pos_sale_id || paymentBySale.has(payment.pos_sale_id)) continue;
    paymentBySale.set(payment.pos_sale_id, payment);
  }
  const saleIds = [...paymentBySale.keys()];
  if (!saleIds.length) return saleExportTable([]);

  let itemQuery = admin
    .from("pos_sale_items")
    .select("id, sale_id, item_type, item_name_snapshot, total_amount, refunded_amount, location_id, employee_id, service_id")
    .eq("studio_id", params.studioId)
    .in("sale_id", saleIds)
    .limit(params.exportCap + 1);
  if (params.employeeId) itemQuery = itemQuery.eq("employee_id", params.employeeId);
  if (params.serviceId) itemQuery = itemQuery.eq("service_id", params.serviceId);
  const { data: items, error: itemError } = await itemQuery;
  if (itemError) throw itemError;

  const { data: sales } = await admin
    .from("pos_sales")
    .select("id, sale_number, status")
    .eq("studio_id", params.studioId)
    .in("id", saleIds)
    .in("status", ["paid", "partially_refunded", "refunded"]);
  const saleById = new Map((sales ?? []).map((sale) => [sale.id as string, sale]));

  const rows: SaleExportSource[] = [];
  for (const item of items ?? []) {
    const sale = saleById.get(item.sale_id as string);
    const payment = paymentBySale.get(item.sale_id as string);
    if (!sale || !payment) continue;
    const gross = Number(item.total_amount ?? 0);
    const refunds = Number(item.refunded_amount ?? 0);
    rows.push({
      sale_item_id: item.id as string,
      sale_number: (sale.sale_number as string | null) ?? null,
      paid_at: revenueEffectiveTimestamp(payment),
      item_type: (item.item_type as string | null) ?? null,
      item_name: (item.item_name_snapshot as string | null) ?? null,
      location_id: (item.location_id as string | null) ?? null,
      employee_id: (item.employee_id as string | null) ?? null,
      service_id: (item.service_id as string | null) ?? null,
      gross,
      refunds,
      payment_status: payment.status,
      source: payment.source,
      sales_channel: payment.sales_channel,
    });
  }
  return saleExportTable(rows);
}
