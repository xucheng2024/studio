import "server-only";

import {
  buildCompletePosCashSaleIdempotency,
  buildCreatePosSaleDraftIdempotency,
  buildLockPosSaleIdempotency,
  buildUpsertPosSaleItemIdempotency,
} from "@/lib/pos-idempotency";
import { requireStaffScope } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";

const POS_MUTATION_ROLES = ["owner", "manager", "frontdesk"] as const;

export type PosMutationErrorCode =
  | "forbidden"
  | "studio_not_found"
  | "studio_suspended"
  | "invalid_request"
  | "not_found"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "idempotency_permanently_failed"
  | "unknown";

export type PosMutationResult<TPayload> =
  | { ok: true; payload: TPayload }
  | { ok: false; code: PosMutationErrorCode; message: string };

export type CreatePosSaleDraftPayload = {
  sale_id: string;
  status: string;
  location_id: string;
  already_completed: boolean;
};

export type UpsertPosSaleItemPayload = {
  sale_id: string;
  item_id: string;
  line_number: number;
  sale_status: string;
  sale_total_amount: number;
  item_total_amount: number;
  item_action: "created" | "updated";
  already_completed: boolean;
};

export type LockPosSalePayload = {
  sale_id: string;
  status: string;
  locked_at: string | null;
  already_locked: boolean;
  already_completed: boolean;
};

export type EnsurePosSalePaymentPayload = {
  sale_id: string;
  payment_id: string;
  payment_status: string;
  payment_reference_code: string | null;
  already_exists: boolean;
};

export type CompletePosCashSalePayload = {
  sale_id: string;
  payment_id: string;
  sale_status: string;
  payment_status: string;
  paid_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  payment_method: string | null;
  receipt_number: string | null;
  already_paid: boolean;
  already_completed: boolean;
};

function trimToNull(raw: string | null | undefined) {
  const value = raw?.trim();
  return value ? value : null;
}

function mapPosRpcError(error: { code?: string; message?: string }): {
  code: PosMutationErrorCode;
  message: string;
} {
  const message = error.message ?? "Unknown POS mutation error";
  if (!error.code) return { code: "unknown", message };

  switch (error.code) {
    case "P0002":
      return { code: "not_found", message };
    case "42501":
      return { code: "forbidden", message };
    case "22023":
      return { code: "invalid_request", message };
    case "23514":
      if (/hash_conflict/i.test(message)) return { code: "idempotency_conflict", message };
      if (/in_progress/i.test(message)) return { code: "idempotency_in_progress", message };
      if (/permanently_failed/i.test(message)) return { code: "idempotency_permanently_failed", message };
      if (/scope|forbidden|permission|role|location/i.test(message)) return { code: "forbidden", message };
      return { code: "invalid_request", message };
    default:
      return { code: "unknown", message };
  }
}

export async function createPosSaleDraft(params: {
  userId: string;
  studioId: string;
  locationId: string;
  salonCustomerId?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
}): Promise<PosMutationResult<CreatePosSaleDraftPayload>> {
  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: params.locationId,
    roles: [...POS_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const idempotency = buildCreatePosSaleDraftIdempotency({
    idempotencyKey: params.idempotencyKey,
    studioId: params.studioId,
    locationId: params.locationId,
    salonCustomerId: params.salonCustomerId,
    note: params.note,
    currency: "SGD",
  });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_pos_sale_draft", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_location_id: params.locationId,
    p_salon_customer_id: trimToNull(params.salonCustomerId),
    p_note: trimToNull(params.note),
    p_idempotency_key: idempotency.idempotencyKey,
    p_request_hash: idempotency.requestHash,
  });

  if (error) {
    const mapped = mapPosRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as CreatePosSaleDraftPayload };
}

export async function upsertPosSaleItem(params: {
  userId: string;
  studioId: string;
  saleId: string;
  itemId?: string | null;
  lineNumber?: number | null;
  itemType?: "service" | "product" | "package" | null;
  serviceId?: string | null;
  productId?: string | null;
  packageId?: string | null;
  salonAppointmentId?: string | null;
  employeeId?: string | null;
  itemNameSnapshot?: string | null;
  itemCurrencySnapshot?: string | null;
  quantity?: number | null;
  unitPriceAmount?: number | null;
  discountAmount?: number | null;
  taxAmount?: number | null;
  idempotencyKey?: string | null;
}): Promise<PosMutationResult<UpsertPosSaleItemPayload>> {
  const idempotency = buildUpsertPosSaleItemIdempotency({
    idempotencyKey: params.idempotencyKey,
    studioId: params.studioId,
    saleId: params.saleId,
    itemId: params.itemId,
    lineNumber: params.lineNumber,
    itemType: params.itemType,
    serviceId: params.serviceId,
    productId: params.productId,
    packageId: params.packageId,
    salonAppointmentId: params.salonAppointmentId,
    employeeId: params.employeeId,
    itemNameSnapshot: params.itemNameSnapshot,
    itemCurrencySnapshot: params.itemCurrencySnapshot,
    quantity: params.quantity,
    unitPriceAmount: params.unitPriceAmount,
    discountAmount: params.discountAmount,
    taxAmount: params.taxAmount,
  });

  const admin = createAdminClient();
  const { data: sale, error: saleErr } = await admin
    .from("pos_sales")
    .select("id, location_id")
    .eq("id", params.saleId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (saleErr) {
    const mapped = mapPosRpcError(saleErr);
    return { ok: false, ...mapped };
  }
  if (!sale || !sale.location_id) {
    return {
      ok: false,
      code: "not_found",
      message: "sale_not_found",
    };
  }

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: sale.location_id,
    roles: [...POS_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const { data, error } = await admin.rpc("upsert_pos_sale_item", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_sale_id: params.saleId,
    p_item_id: trimToNull(params.itemId),
    p_line_number: params.lineNumber ?? null,
    p_item_type: trimToNull(params.itemType),
    p_service_id: trimToNull(params.serviceId),
    p_product_id: trimToNull(params.productId),
    p_package_id: trimToNull(params.packageId),
    p_salon_appointment_id: trimToNull(params.salonAppointmentId),
    p_employee_id: trimToNull(params.employeeId),
    p_item_name_snapshot: trimToNull(params.itemNameSnapshot),
    p_item_currency_snapshot: trimToNull(params.itemCurrencySnapshot) ?? "SGD",
    p_quantity: params.quantity ?? null,
    p_unit_price_amount: params.unitPriceAmount ?? null,
    p_discount_amount: params.discountAmount ?? 0,
    p_tax_amount: params.taxAmount ?? 0,
    p_idempotency_key: idempotency.idempotencyKey,
    p_request_hash: idempotency.requestHash,
  });

  if (error) {
    const mapped = mapPosRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as UpsertPosSaleItemPayload };
}

export async function lockPosSale(params: {
  userId: string;
  studioId: string;
  saleId: string;
  idempotencyKey?: string | null;
}): Promise<PosMutationResult<LockPosSalePayload>> {
  const idempotency = buildLockPosSaleIdempotency({
    idempotencyKey: params.idempotencyKey,
    studioId: params.studioId,
    saleId: params.saleId,
  });

  const admin = createAdminClient();
  const { data: sale, error: saleErr } = await admin
    .from("pos_sales")
    .select("id, location_id")
    .eq("id", params.saleId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (saleErr) {
    const mapped = mapPosRpcError(saleErr);
    return { ok: false, ...mapped };
  }
  if (!sale || !sale.location_id) {
    return {
      ok: false,
      code: "not_found",
      message: "sale_not_found",
    };
  }

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: sale.location_id,
    roles: [...POS_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const { data, error } = await admin.rpc("lock_pos_sale", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_sale_id: params.saleId,
    p_idempotency_key: idempotency.idempotencyKey,
    p_request_hash: idempotency.requestHash,
  });

  if (error) {
    const mapped = mapPosRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as LockPosSalePayload };
}

export async function ensurePosSalePayment(params: {
  userId: string;
  studioId: string;
  saleId: string;
}): Promise<PosMutationResult<EnsurePosSalePaymentPayload>> {
  const admin = createAdminClient();

  const { data: sale, error: saleErr } = await admin
    .from("pos_sales")
    .select("id, studio_id, location_id, salon_customer_id, status, total_amount, currency")
    .eq("id", params.saleId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{
      id: string;
      studio_id: string;
      location_id: string | null;
      salon_customer_id: string | null;
      status: string;
      total_amount: number;
      currency: string;
    }>();

  if (saleErr) {
    const mapped = mapPosRpcError(saleErr);
    return { ok: false, ...mapped };
  }
  if (!sale || !sale.location_id) {
    return {
      ok: false,
      code: "not_found",
      message: "sale_not_found",
    };
  }

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: sale.location_id,
    roles: [...POS_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  if (sale.status !== "pending_payment" && sale.status !== "paid" && sale.status !== "partially_refunded" && sale.status !== "refunded") {
    return {
      ok: false,
      code: "invalid_request",
      message: `sale ${sale.id} status ${sale.status} is not ready for payment`,
    };
  }

  const { data: existing } = await admin
    .from("payments")
    .select("id, status, reference_code")
    .eq("studio_id", params.studioId)
    .eq("pos_sale_id", sale.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string; reference_code: string | null }>();

  if (existing) {
    return {
      ok: true,
      payload: {
        sale_id: sale.id,
        payment_id: existing.id,
        payment_status: existing.status,
        payment_reference_code: existing.reference_code,
        already_exists: true,
      },
    };
  }

  const customer = sale.salon_customer_id
    ? (await admin
      .from("salon_customers")
      .select("user_id, full_name, email, phone")
      .eq("id", sale.salon_customer_id)
      .eq("studio_id", params.studioId)
      .maybeSingle<{ user_id: string | null; full_name: string | null; email: string | null; phone: string | null }>()).data
    : null;

  const referenceCode = `POS-${sale.id.replaceAll("-", "")}`;
  const insertPayload = {
    studio_id: params.studioId,
    location_id: sale.location_id,
    pos_sale_id: sale.id,
    client_id: customer?.user_id ?? null,
    guest_name: customer?.user_id ? null : (customer?.full_name ?? null),
    guest_email: customer?.user_id ? null : (customer?.email ?? null),
    guest_phone: customer?.user_id ? null : (customer?.phone ?? null),
    amount: Number(sale.total_amount ?? 0),
    currency: sale.currency,
    payment_method: "cash",
    sales_channel: "frontdesk",
    source: "pos_sale",
    status: "pending",
    reference_code: referenceCode,
    type: "single",
    remaining_uses: 0,
  };

  const { data: created, error: createErr } = await admin
    .from("payments")
    .insert(insertPayload)
    .select("id, status, reference_code")
    .single<{ id: string; status: string; reference_code: string | null }>();

  if (createErr) {
    if (createErr.code === "23505") {
      const { data: concurrent } = await admin
        .from("payments")
        .select("id, status, reference_code")
        .eq("studio_id", params.studioId)
        .eq("pos_sale_id", sale.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; status: string; reference_code: string | null }>();
      if (concurrent) {
        return {
          ok: true,
          payload: {
            sale_id: sale.id,
            payment_id: concurrent.id,
            payment_status: concurrent.status,
            payment_reference_code: concurrent.reference_code,
            already_exists: true,
          },
        };
      }
    }

    const mapped = mapPosRpcError(createErr);
    return { ok: false, ...mapped };
  }

  return {
    ok: true,
    payload: {
      sale_id: sale.id,
      payment_id: created.id,
      payment_status: created.status,
      payment_reference_code: created.reference_code,
      already_exists: false,
    },
  };
}

export async function completePosCashSale(params: {
  userId: string;
  studioId: string;
  saleId: string;
  idempotencyKey?: string | null;
}): Promise<PosMutationResult<CompletePosCashSalePayload>> {
  const idempotency = buildCompletePosCashSaleIdempotency({
    idempotencyKey: params.idempotencyKey,
    studioId: params.studioId,
    saleId: params.saleId,
  });

  const admin = createAdminClient();
  const { data: sale, error: saleErr } = await admin
    .from("pos_sales")
    .select("id, location_id")
    .eq("id", params.saleId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (saleErr) {
    const mapped = mapPosRpcError(saleErr);
    return { ok: false, ...mapped };
  }
  if (!sale || !sale.location_id) {
    return {
      ok: false,
      code: "not_found",
      message: "sale_not_found",
    };
  }

  const scope = await requireStaffScope({
    userId: params.userId,
    studioId: params.studioId,
    locationId: sale.location_id,
    roles: [...POS_MUTATION_ROLES],
  });
  if (!scope.ok) {
    return {
      ok: false,
      code: scope.reason,
      message: scope.reason,
    };
  }

  const { data, error } = await admin.rpc("complete_pos_cash_sale", {
    p_actor_id: params.userId,
    p_actor_role: scope.role,
    p_studio_id: params.studioId,
    p_sale_id: params.saleId,
    p_idempotency_key: idempotency.idempotencyKey,
    p_request_hash: idempotency.requestHash,
  });

  if (error) {
    const mapped = mapPosRpcError(error);
    return { ok: false, ...mapped };
  }

  return { ok: true, payload: data as CompletePosCashSalePayload };
}
