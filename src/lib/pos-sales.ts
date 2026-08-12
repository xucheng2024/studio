import "server-only";

import {
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

