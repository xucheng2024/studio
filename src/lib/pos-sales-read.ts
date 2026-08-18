import "server-only";

import { buildAccessContext } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";

const POS_READ_ROLES = ["owner", "manager", "frontdesk"] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PosReadRole = (typeof POS_READ_ROLES)[number];

export type PosReadErrorCode = "forbidden" | "invalid_request" | "not_found";

export type PosSaleListRow = {
  id: string;
  sale_number: string | null;
  status: string;
  currency: string;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  location_id: string;
  location_name: string | null;
  salon_customer_id: string | null;
  customer_name: string | null;
  locked_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  payment_progress: {
    status: "no_payment" | "pending" | "paid" | "partially_refunded" | "refunded" | "failed_or_expired";
    source: "payments+pos_sales";
    payment_count: number;
    latest_payment_id: string | null;
    latest_payment_status: string | null;
    latest_payment_reference_code: string | null;
  };
};

export type PosSaleItemDetailRow = {
  id: string;
  line_number: number;
  item_type: "service" | "product" | "package";
  service_id: string | null;
  product_id: string | null;
  package_id: string | null;
  salon_appointment_id: string | null;
  employee_id: string | null;
  item_name_snapshot: string;
  item_currency_snapshot: string;
  quantity: number;
  unit_price_amount: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  refunded_quantity: number;
  refunded_amount: number;
};

export type PosSaleDetail = {
  sale: PosSaleListRow & {
    note: string | null;
    receipt_number: string | null;
    refunded_amount: number;
    paid_at: string | null;
    voided_at: string | null;
    cash_session_id: string | null;
    cash_collected_at: string | null;
    cash_collected_by: string | null;
  };
  items: PosSaleItemDetailRow[];
  payments: Array<{
    id: string;
    status: string;
    amount: number;
    currency: string;
    payment_method: string | null;
    cash_session_id: string | null;
    reference_code: string | null;
    created_at: string;
    verified_at: string | null;
    paid_at: string | null;
    verified_by: string | null;
    verified_by_email: string | null;
    invoice_number: string | null;
    invoice_status: string | null;
  }>;
};

type PosReadAccess = {
  studioId: string;
  role: PosReadRole;
  allowedLocationIds: string[];
  hasGlobalLocationScope: boolean;
};

type PosPaymentSnapshot = {
  id: string;
  pos_sale_id: string | null;
  status: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  cash_session_id: string | null;
  reference_code: string | null;
  created_at: string;
  verified_at: string | null;
  paid_at: string | null;
  verified_by: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
};

function computePaymentProgress(input: {
  saleStatus: string;
  payments: PosPaymentSnapshot[];
}): PosSaleListRow["payment_progress"] {
  const latest = [...input.payments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const statuses = new Set(input.payments.map((row) => row.status));

  let status: PosSaleListRow["payment_progress"]["status"] = "no_payment";
  if (input.saleStatus === "partially_refunded") {
    status = "partially_refunded";
  } else if (input.saleStatus === "refunded") {
    status = "refunded";
  } else if (statuses.has("paid") || input.saleStatus === "paid") {
    status = "paid";
  } else if (statuses.has("pending") || input.saleStatus === "pending_payment") {
    status = "pending";
  } else if (statuses.has("failed") || statuses.has("expired")) {
    status = "failed_or_expired";
  }

  return {
    status,
    source: "payments+pos_sales",
    payment_count: input.payments.length,
    latest_payment_id: latest?.id ?? null,
    latest_payment_status: latest?.status ?? null,
    latest_payment_reference_code: latest?.reference_code ?? null,
  };
}

function isUuid(value: string | null | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function pickHighestRole(roles: PosReadRole[]): PosReadRole {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("manager")) return "manager";
  return "frontdesk";
}

async function resolvePosReadAccess(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
}): Promise<{ ok: true; access: PosReadAccess } | { ok: false; code: PosReadErrorCode; message: string }> {
  if (!isUuid(params.userId) || !isUuid(params.studioId)) {
    return { ok: false, code: "invalid_request", message: "invalid_uuid" };
  }
  if (params.locationId && !isUuid(params.locationId)) {
    return { ok: false, code: "invalid_request", message: "invalid_location_uuid" };
  }

  const ctx = await buildAccessContext(params.userId, params.email ?? null, params.locationId ?? null);
  const scopedMemberships = ctx.memberships.filter(
    (membership) =>
      membership.studio_id === params.studioId
      && POS_READ_ROLES.includes(membership.role as PosReadRole),
  );
  if (!scopedMemberships.length) {
    return { ok: false, code: "forbidden", message: "forbidden" };
  }

  const hasGlobalLocationScope = scopedMemberships.some((membership) => membership.location_id == null);
  const allowedLocationIds = hasGlobalLocationScope
    ? ctx.locations
      .filter((location) => location.studio_id === params.studioId)
      .map((location) => location.id)
    : [...new Set(scopedMemberships.map((membership) => membership.location_id).filter((id): id is string => Boolean(id)))];

  if (!allowedLocationIds.length) {
    return { ok: false, code: "forbidden", message: "forbidden" };
  }
  if (params.locationId && !allowedLocationIds.includes(params.locationId)) {
    return { ok: false, code: "forbidden", message: "location_out_of_scope" };
  }

  return {
    ok: true,
    access: {
      studioId: params.studioId,
      role: pickHighestRole(scopedMemberships.map((membership) => membership.role as PosReadRole)),
      allowedLocationIds,
      hasGlobalLocationScope,
    },
  };
}

export async function listPosSalesForDashboard(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  locationId?: string | null;
  salonCustomerId?: string | null;
  status?: "draft" | "pending_payment" | "paid" | "partially_refunded" | "refunded" | "voided";
  limit?: number;
  offset?: number;
}): Promise<
  | { ok: true; sales: PosSaleListRow[]; totalCount: number; role: PosReadRole }
  | { ok: false; code: PosReadErrorCode; message: string }
> {
  const access = await resolvePosReadAccess(params);
  if (!access.ok) return access;

  const limit = Math.max(1, Math.min(200, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);
  const admin = createAdminClient();

  let query = admin
    .from("pos_sales")
    .select(
      "id, sale_number, status, currency, subtotal_amount, discount_amount, tax_amount, total_amount, location_id, salon_customer_id, locked_at, submitted_at, created_at, updated_at, locations(name), salon_customers(full_name)",
      { count: "exact" },
    )
    .eq("studio_id", access.access.studioId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.status) query = query.eq("status", params.status);
  if (params.salonCustomerId) {
    if (!UUID_PATTERN.test(params.salonCustomerId)) {
      return { ok: false, code: "invalid_request", message: "Invalid customer." };
    }
    query = query.eq("salon_customer_id", params.salonCustomerId);
  }
  if (params.locationId) {
    query = query.eq("location_id", params.locationId);
  } else if (!access.access.hasGlobalLocationScope) {
    query = query.in("location_id", access.access.allowedLocationIds);
  }

  const { data, count, error } = await query;
  if (error) throw error;

  const saleIds = (data ?? []).map((row) => row.id);
  const { data: paymentRows, error: paymentError } =
    saleIds.length > 0
      ? await admin
          .from("payments")
          .select("id, pos_sale_id, status, amount, currency, payment_method, reference_code, created_at, verified_at, paid_at, verified_by")
          .eq("studio_id", access.access.studioId)
          .in("pos_sale_id", saleIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };
  if (paymentError) throw paymentError;

  const paymentsBySaleId = new Map<string, PosPaymentSnapshot[]>();
  for (const payment of (paymentRows ?? []) as PosPaymentSnapshot[]) {
    if (!payment.pos_sale_id) continue;
    const bucket = paymentsBySaleId.get(payment.pos_sale_id) ?? [];
    bucket.push(payment);
    paymentsBySaleId.set(payment.pos_sale_id, bucket);
  }

  const sales = (data ?? []).map((row) => {
    const location = Array.isArray(row.locations) ? row.locations[0] : row.locations;
    const customer = Array.isArray(row.salon_customers) ? row.salon_customers[0] : row.salon_customers;
    const paymentProgress = computePaymentProgress({
      saleStatus: row.status,
      payments: paymentsBySaleId.get(row.id) ?? [],
    });
    return {
      id: row.id,
      sale_number: row.sale_number,
      status: row.status,
      currency: row.currency,
      subtotal_amount: row.subtotal_amount,
      discount_amount: row.discount_amount,
      tax_amount: row.tax_amount,
      total_amount: row.total_amount,
      location_id: row.location_id,
      location_name: location?.name ?? null,
      salon_customer_id: row.salon_customer_id,
      customer_name: customer?.full_name ?? null,
      locked_at: row.locked_at,
      submitted_at: row.submitted_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      payment_progress: paymentProgress,
    } as PosSaleListRow;
  });

  return {
    ok: true,
    sales,
    totalCount: count ?? sales.length,
    role: access.access.role,
  };
}

export async function getPosSaleDetailForDashboard(params: {
  userId: string;
  email?: string | null;
  studioId: string;
  saleId: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; detail: PosSaleDetail; role: PosReadRole }
  | { ok: false; code: PosReadErrorCode; message: string }
> {
  if (!isUuid(params.saleId)) {
    return { ok: false, code: "invalid_request", message: "invalid_sale_uuid" };
  }

  const access = await resolvePosReadAccess(params);
  if (!access.ok) return access;

  const admin = createAdminClient();
  let saleQuery = admin
    .from("pos_sales")
    .select(
      "id, sale_number, receipt_number, status, currency, subtotal_amount, discount_amount, tax_amount, total_amount, refunded_amount, location_id, salon_customer_id, note, locked_at, submitted_at, paid_at, voided_at, created_at, updated_at, locations(name), salon_customers(full_name)",
    )
    .eq("id", params.saleId)
    .eq("studio_id", access.access.studioId);

  if (params.locationId) {
    saleQuery = saleQuery.eq("location_id", params.locationId);
  } else if (!access.access.hasGlobalLocationScope) {
    saleQuery = saleQuery.in("location_id", access.access.allowedLocationIds);
  }

  const { data: saleRow, error: saleError } = await saleQuery.maybeSingle();
  if (saleError) throw saleError;
  if (!saleRow) {
    return { ok: false, code: "not_found", message: "sale_not_found" };
  }

  const { data: itemRows, error: itemsError } = await admin
    .from("pos_sale_items")
    .select("id, line_number, item_type, service_id, product_id, package_id, salon_appointment_id, employee_id, item_name_snapshot, item_currency_snapshot, quantity, unit_price_amount, subtotal_amount, discount_amount, tax_amount, total_amount, refunded_quantity, refunded_amount")
    .eq("sale_id", params.saleId)
    .eq("studio_id", access.access.studioId)
    .order("line_number", { ascending: true });
  if (itemsError) throw itemsError;

  const { data: paymentRows, error: paymentError } = await admin
    .from("payments")
    .select("id, pos_sale_id, status, amount, currency, payment_method, cash_session_id, reference_code, created_at, verified_at, paid_at, verified_by, invoice_number, invoice_status")
    .eq("studio_id", access.access.studioId)
    .eq("pos_sale_id", params.saleId)
    .order("created_at", { ascending: false });
  if (paymentError) throw paymentError;

  const verifiedByIds = [...new Set(
    ((paymentRows ?? []) as PosPaymentSnapshot[])
      .map((payment) => payment.verified_by)
      .filter((value): value is string => Boolean(value)),
  )];
  const { data: verifiedUsers, error: verifiedUsersError } =
    verifiedByIds.length > 0
      ? await admin
          .from("users")
          .select("id, email")
          .in("id", verifiedByIds)
      : { data: [], error: null };
  if (verifiedUsersError) throw verifiedUsersError;
  const verifiedByMap = new Map((verifiedUsers ?? []).map((user) => [user.id, user.email ?? null]));

  const payments = ((paymentRows ?? []) as PosPaymentSnapshot[]).map((payment) => ({
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    payment_method: payment.payment_method,
    cash_session_id: payment.cash_session_id,
    reference_code: payment.reference_code,
    created_at: payment.created_at,
    verified_at: payment.verified_at,
    paid_at: payment.paid_at,
    verified_by: payment.verified_by,
    verified_by_email: payment.verified_by ? (verifiedByMap.get(payment.verified_by) ?? null) : null,
    invoice_number: payment.invoice_number,
    invoice_status: payment.invoice_status,
  }));

  const latestCashPaid = payments.find((payment) => payment.status === "paid" && payment.payment_method === "cash") ?? null;

  const paymentProgress = computePaymentProgress({
    saleStatus: saleRow.status,
    payments: (paymentRows ?? []) as PosPaymentSnapshot[],
  });

  const location = Array.isArray(saleRow.locations) ? saleRow.locations[0] : saleRow.locations;
  const customer = Array.isArray(saleRow.salon_customers) ? saleRow.salon_customers[0] : saleRow.salon_customers;

  return {
    ok: true,
    role: access.access.role,
    detail: {
      sale: {
        id: saleRow.id,
        sale_number: saleRow.sale_number,
        status: saleRow.status,
        currency: saleRow.currency,
        subtotal_amount: saleRow.subtotal_amount,
        discount_amount: saleRow.discount_amount,
        tax_amount: saleRow.tax_amount,
        total_amount: saleRow.total_amount,
        location_id: saleRow.location_id,
        location_name: location?.name ?? null,
        salon_customer_id: saleRow.salon_customer_id,
        customer_name: customer?.full_name ?? null,
        locked_at: saleRow.locked_at,
        submitted_at: saleRow.submitted_at,
        created_at: saleRow.created_at,
        updated_at: saleRow.updated_at,
        payment_progress: paymentProgress,
        note: saleRow.note,
        receipt_number: saleRow.receipt_number,
        refunded_amount: saleRow.refunded_amount,
        paid_at: saleRow.paid_at,
        voided_at: saleRow.voided_at,
        cash_session_id: latestCashPaid?.cash_session_id ?? null,
        cash_collected_at: latestCashPaid?.paid_at ?? latestCashPaid?.verified_at ?? null,
        cash_collected_by: latestCashPaid?.verified_by_email ?? latestCashPaid?.verified_by ?? null,
      },
      items: (itemRows ?? []).map((item) => ({
        id: item.id,
        line_number: item.line_number,
        item_type: item.item_type,
        service_id: item.service_id,
        product_id: item.product_id,
        package_id: item.package_id,
        salon_appointment_id: item.salon_appointment_id,
        employee_id: item.employee_id,
        item_name_snapshot: item.item_name_snapshot,
        item_currency_snapshot: item.item_currency_snapshot,
        quantity: item.quantity,
        unit_price_amount: item.unit_price_amount,
        subtotal_amount: item.subtotal_amount,
        discount_amount: item.discount_amount,
        tax_amount: item.tax_amount,
        total_amount: item.total_amount,
        refunded_quantity: item.refunded_quantity,
        refunded_amount: item.refunded_amount,
      })),
      payments,
    },
  };
}
