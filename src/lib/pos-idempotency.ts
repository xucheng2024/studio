import { hashIdempotencyRequest } from "@/lib/idempotency";

export type PosWriteOperation = "pos_sale:create_draft" | "pos_sale_item:upsert" | "pos_sale:lock";

export type PosDraftHashPayload = {
  operation: "pos_sale:create_draft";
  studioId: string;
  locationId: string;
  salonCustomerId: string | null;
  note: string | null;
  currency: string;
};

export type PosItemUpsertHashPayload = {
  operation: "pos_sale_item:upsert";
  studioId: string;
  saleId: string;
  itemId: string | null;
  lineNumber: number | null;
  itemType: string | null;
  serviceId: string | null;
  productId: string | null;
  packageId: string | null;
  salonAppointmentId: string | null;
  employeeId: string | null;
  itemNameSnapshot: string | null;
  itemCurrencySnapshot: string;
  quantity: number | null;
  unitPriceAmount: number | null;
  discountAmount: number;
  taxAmount: number;
};

export type PosLockHashPayload = {
  operation: "pos_sale:lock";
  studioId: string;
  saleId: string;
};

type PosIdempotencyMeta<TPayload> = {
  idempotencyKey: string;
  requestHash: string;
  requestPayload: TPayload;
};

function trimToNull(raw: string | null | undefined) {
  const value = raw?.trim();
  return value ? value : null;
}

function normalizeCurrency(raw: string | null | undefined, fallback = "SGD") {
  const value = raw?.trim().toUpperCase();
  return value || fallback;
}

function normalizeOperationIdempotency<TPayload>(params: {
  idempotencyKey?: string | null;
  requestPayload: TPayload;
}): PosIdempotencyMeta<TPayload> {
  const idempotencyKey = trimToNull(params.idempotencyKey) ?? crypto.randomUUID();
  return {
    idempotencyKey,
    requestHash: hashIdempotencyRequest(params.requestPayload),
    requestPayload: params.requestPayload,
  };
}

export function buildCreatePosSaleDraftIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  locationId: string;
  salonCustomerId?: string | null;
  note?: string | null;
  currency?: string | null;
}) {
  const requestPayload: PosDraftHashPayload = {
    operation: "pos_sale:create_draft",
    studioId: params.studioId,
    locationId: params.locationId,
    salonCustomerId: trimToNull(params.salonCustomerId) ?? null,
    note: trimToNull(params.note),
    currency: normalizeCurrency(params.currency),
  };
  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}

export function buildUpsertPosSaleItemIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  saleId: string;
  itemId?: string | null;
  lineNumber?: number | null;
  itemType?: string | null;
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
}) {
  const requestPayload: PosItemUpsertHashPayload = {
    operation: "pos_sale_item:upsert",
    studioId: params.studioId,
    saleId: params.saleId,
    itemId: trimToNull(params.itemId) ?? null,
    lineNumber: params.lineNumber ?? null,
    itemType: trimToNull(params.itemType),
    serviceId: trimToNull(params.serviceId) ?? null,
    productId: trimToNull(params.productId) ?? null,
    packageId: trimToNull(params.packageId) ?? null,
    salonAppointmentId: trimToNull(params.salonAppointmentId) ?? null,
    employeeId: trimToNull(params.employeeId) ?? null,
    itemNameSnapshot: trimToNull(params.itemNameSnapshot),
    itemCurrencySnapshot: normalizeCurrency(params.itemCurrencySnapshot),
    quantity: params.quantity ?? null,
    unitPriceAmount: params.unitPriceAmount ?? null,
    discountAmount: params.discountAmount ?? 0,
    taxAmount: params.taxAmount ?? 0,
  };
  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}

export function buildLockPosSaleIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  saleId: string;
}) {
  const requestPayload: PosLockHashPayload = {
    operation: "pos_sale:lock",
    studioId: params.studioId,
    saleId: params.saleId,
  };
  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}
