import { hashIdempotencyRequest } from "@/lib/idempotency";

export type PosWriteOperation =
  | "pos_sale:create_draft"
  | "pos_sale_item:upsert"
  | "pos_sale:lock"
  | "pos_sale:complete_cash"
  | "pos_cash_session:open"
  | "pos_cash_session:close"
  | "pos_sale:void"
  | "pos_sale:refund_items";

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

export type PosCompleteCashHashPayload = {
  operation: "pos_sale:complete_cash";
  studioId: string;
  saleId: string;
};

export type PosVoidSaleHashPayload = {
  operation: "pos_sale:void";
  studioId: string;
  saleId: string;
  reason: string | null;
};

export type PosOpenCashSessionHashPayload = {
  operation: "pos_cash_session:open";
  studioId: string;
  locationId: string;
  openingFloat: number;
  notes: string | null;
};

export type PosCloseCashSessionHashPayload = {
  operation: "pos_cash_session:close";
  studioId: string;
  sessionId: string;
  countedCash: number;
  notes: string | null;
};

export type PosRefundItemInputHash = {
  itemId: string;
  refundQty: number | null;
  refundAmount: number | null;
};

export type PosRefundItemsHashPayload = {
  operation: "pos_sale:refund_items";
  studioId: string;
  saleId: string;
  reason: string | null;
  items: PosRefundItemInputHash[];
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

export function buildCompletePosCashSaleIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  saleId: string;
}) {
  const requestPayload: PosCompleteCashHashPayload = {
    operation: "pos_sale:complete_cash",
    studioId: params.studioId,
    saleId: params.saleId,
  };
  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}

export function buildVoidPosSaleIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  saleId: string;
  reason?: string | null;
}) {
  const requestPayload: PosVoidSaleHashPayload = {
    operation: "pos_sale:void",
    studioId: params.studioId,
    saleId: params.saleId,
    reason: trimToNull(params.reason),
  };
  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}

export function buildOpenPosCashSessionIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  locationId: string;
  openingFloat?: number | null;
  notes?: string | null;
}) {
  const requestPayload: PosOpenCashSessionHashPayload = {
    operation: "pos_cash_session:open",
    studioId: params.studioId,
    locationId: params.locationId,
    openingFloat: params.openingFloat == null ? 0 : Math.round(params.openingFloat * 100) / 100,
    notes: trimToNull(params.notes),
  };

  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}

export function buildClosePosCashSessionIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  sessionId: string;
  countedCash: number;
  notes?: string | null;
}) {
  const requestPayload: PosCloseCashSessionHashPayload = {
    operation: "pos_cash_session:close",
    studioId: params.studioId,
    sessionId: params.sessionId,
    countedCash: Math.round(params.countedCash * 100) / 100,
    notes: trimToNull(params.notes),
  };

  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}

export function buildRefundPosSaleItemsIdempotency(params: {
  idempotencyKey?: string | null;
  studioId: string;
  saleId: string;
  reason?: string | null;
  items: Array<{
    itemId: string;
    refundQty?: number | null;
    refundAmount?: number | null;
  }>;
}) {
  const normalizedItems = [...params.items]
    .map((item) => ({
      itemId: item.itemId.trim(),
      refundQty: item.refundQty == null ? null : Math.round(item.refundQty * 1000) / 1000,
      refundAmount: item.refundAmount == null ? null : Math.round(item.refundAmount * 100) / 100,
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

  const requestPayload: PosRefundItemsHashPayload = {
    operation: "pos_sale:refund_items",
    studioId: params.studioId,
    saleId: params.saleId,
    reason: trimToNull(params.reason),
    items: normalizedItems,
  };

  return normalizeOperationIdempotency({
    idempotencyKey: params.idempotencyKey,
    requestPayload,
  });
}
