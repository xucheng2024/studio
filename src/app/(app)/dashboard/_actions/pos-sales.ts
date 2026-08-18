"use server";

import {
  closePosCashSession,
  completePosCashSale,
  createPosSaleDraft,
  ensurePosSalePayment,
  lockPosSale,
  openPosCashSession,
  refundPosSaleItems,
  upsertPosSaleItem,
  voidPosSale,
} from "@/lib/pos-sales";
import { createPosSalonCustomer } from "@/lib/salon-customers";
import { recordPosOperationFailure } from "@/lib/pos-operation-observability";
import { mapPosMutationMessage } from "@/lib/pos-error-message";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

export type PosProceedToPaymentResult = DashboardFormResult & {
  payment_id?: string;
  payment_reference_code?: string | null;
};

export type PosDraftResult = DashboardFormResult & {
  sale_id?: string;
};

export type PosItemResult = DashboardFormResult & {
  sale_id?: string;
  item_id?: string;
  line_number?: number;
  sale_total_amount?: number;
  item_total_amount?: number;
};

export type PosCashCompleteResult = DashboardFormResult & {
  payment_id?: string;
  receipt_number?: string | null;
  sale_status?: string;
};

export type PosCustomerCreateResult = DashboardFormResult & {
  customer_id?: string;
  full_name?: string;
  phone?: string | null;
  email?: string | null;
};

function asNumberOrNull(raw: FormDataEntryValue | null) {
  if (raw == null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function asIntegerOrNull(raw: FormDataEntryValue | null) {
  const value = asNumberOrNull(raw);
  if (value == null) return null;
  return Math.trunc(value);
}

function parseRefundItems(formData: FormData) {
  const selectedIds = formData
    .getAll("refund_item_id")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  const uniqueIds = [...new Set(selectedIds)];
  const items: Array<{ itemId: string; refundQty?: number | null; refundAmount?: number | null }> = [];

  for (const itemId of uniqueIds) {
    const refundQty = asNumberOrNull(formData.get(`refund_qty__${itemId}`));
    const refundAmount = asNumberOrNull(formData.get(`refund_amount__${itemId}`));

    if (refundQty != null && refundQty <= 0) {
      return { ok: false as const, message: "Refund quantity must be greater than zero." };
    }
    if (refundAmount != null && refundAmount <= 0) {
      return { ok: false as const, message: "Refund amount must be greater than zero." };
    }
    if ((refundQty == null) === (refundAmount == null)) {
      return {
        ok: false as const,
        message: "Each selected row needs either refund quantity or refund amount.",
      };
    }

    items.push({ itemId, refundQty, refundAmount });
  }

  if (items.length === 0) {
    return { ok: false as const, message: "Select at least one row to refund." };
  }

  return { ok: true as const, items };
}

export async function createPosSaleDraftAction(
  _prevState: PosDraftResult | null,
  formData: FormData,
): Promise<PosDraftResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const salonCustomerId = String(formData.get("salon_customer_id") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;

  if (!studioId || !locationId) {
    return err("Missing required fields: studio and location.");
  }

  const { user } = await requireUser();
  const result = await createPosSaleDraft({
    userId: user.id,
    studioId,
    locationId,
    salonCustomerId,
    note,
    idempotencyKey,
  });

  if (!result.ok) {
    console.log("createPosSaleDraftAction failed", {
      code: result.code,
      message: result.message,
      studioId,
      locationId,
    });
    return err(mapPosMutationMessage(result.code, result.message || "Could not create POS draft."));
  }

  return {
    ok: true,
    message: result.payload.already_completed ? "POS draft already created." : "POS draft created.",
    sale_id: result.payload.sale_id,
  };
}

export async function upsertPosSaleItemAction(
  _prevState: PosItemResult | null,
  formData: FormData,
): Promise<PosItemResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const itemTypeRaw = String(formData.get("item_type") ?? "").trim().toLowerCase();
  const itemType = itemTypeRaw ? itemTypeRaw : null;

  if (!studioId || !saleId) {
    return err("Missing required fields: studio and sale.");
  }

  const { user } = await requireUser();
  const result = await upsertPosSaleItem({
    userId: user.id,
    studioId,
    saleId,
    itemId: String(formData.get("item_id") ?? "").trim() || null,
    lineNumber: asIntegerOrNull(formData.get("line_number")),
    itemType: (itemType as "service" | "product" | "package" | null) ?? null,
    serviceId: String(formData.get("service_id") ?? "").trim() || null,
    productId: String(formData.get("product_id") ?? "").trim() || null,
    packageId: String(formData.get("package_id") ?? "").trim() || null,
    salonAppointmentId: String(formData.get("salon_appointment_id") ?? "").trim() || null,
    employeeId: String(formData.get("employee_id") ?? "").trim() || null,
    itemNameSnapshot: String(formData.get("item_name_snapshot") ?? "").trim() || null,
    itemCurrencySnapshot: String(formData.get("item_currency_snapshot") ?? "").trim() || "SGD",
    quantity: asNumberOrNull(formData.get("quantity")),
    unitPriceAmount: asNumberOrNull(formData.get("unit_price_amount")),
    discountAmount: asNumberOrNull(formData.get("discount_amount")),
    taxAmount: asNumberOrNull(formData.get("tax_amount")),
    idempotencyKey: String(formData.get("idempotency_key") ?? "").trim() || null,
  });

  if (!result.ok) {
    console.log("upsertPosSaleItemAction failed", {
      code: result.code,
      message: result.message,
      studioId,
      saleId,
      itemType,
    });
    return err(mapPosMutationMessage(result.code, result.message || "Could not save POS item."));
  }

  return {
    ok: true,
    message: result.payload.item_action === "updated" ? "POS item updated." : "POS item created.",
    sale_id: result.payload.sale_id,
    item_id: result.payload.item_id,
    line_number: result.payload.line_number,
    sale_total_amount: result.payload.sale_total_amount,
    item_total_amount: result.payload.item_total_amount,
  };
}

export async function createPosSalonCustomerAction(
  _prevState: PosCustomerCreateResult | null,
  formData: FormData,
): Promise<PosCustomerCreateResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;

  if (!studioId || !locationId) {
    return err("Missing required fields: studio and location.");
  }

  const { user } = await requireUser();
  const result = await createPosSalonCustomer({
    userId: user.id,
    studioId,
    locationId,
    input: { fullName, email, phone },
  });

  if (!result.ok) {
    console.log("createPosSalonCustomerAction failed", {
      reason: result.reason,
      message: result.message,
      studioId,
      locationId,
    });
    if (result.reason === "invalid_request" && result.message === "full_name_required") {
      return err("Customer name is required.");
    }
    if (result.reason === "invalid_request" && result.message === "contact_required") {
      return err("Add a phone number or email.");
    }
    if (result.reason === "forbidden") return err("You do not have permission to create a customer.");
    return err(result.message || "Could not create customer.");
  }

  const duplicateNote = result.duplicateCandidates.length > 0
    ? " Possible duplicate found — not merged."
    : "";
  return {
    ok: true,
    message: `Customer saved.${duplicateNote}`,
    customer_id: result.customer.id,
    full_name: result.customer.full_name,
    phone: result.customer.phone,
    email: result.customer.email,
  };
}

export async function lockPosSaleAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;

  if (!studioId || !saleId) {
    return err("Missing required fields: studio and sale.");
  }

  const { user } = await requireUser();
  const result = await lockPosSale({
    userId: user.id,
    studioId,
    saleId,
    idempotencyKey,
  });

  if (!result.ok) {
    return err(mapPosMutationMessage(result.code, result.message || "Could not lock POS sale."));
  }

  if (result.payload.already_locked) {
    return ok("Sale is already ready for payment.");
  }
  return ok("Sale is ready for payment.");
}

export async function proceedPosSaleToPaymentAction(
  _prevState: PosProceedToPaymentResult | null,
  formData: FormData,
): Promise<PosProceedToPaymentResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;

  if (!studioId || !saleId) {
    return err("Missing required fields: studio and sale.");
  }

  const { user } = await requireUser();
  const lockResult = await lockPosSale({
    userId: user.id,
    studioId,
    saleId,
    idempotencyKey,
  });

  if (!lockResult.ok) {
    return err(mapPosMutationMessage(lockResult.code, lockResult.message || "Could not lock POS sale."));
  }

  const ensurePayment = await ensurePosSalePayment({
    userId: user.id,
    studioId,
    saleId,
  });
  if (!ensurePayment.ok) {
    return err(mapPosMutationMessage(ensurePayment.code, ensurePayment.message || "Could not create POS payment."));
  }

  const paymentResult = ensurePayment.payload;
  return {
    ok: true,
    message: paymentResult.already_exists
      ? "Payment already exists. Opened current payment flow."
      : "Payment created. Proceed to collect payment.",
    payment_id: paymentResult.payment_id,
    payment_reference_code: paymentResult.payment_reference_code,
  };
}

export async function completePosCashSaleAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<PosCashCompleteResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;

  if (!studioId || !saleId) {
    return err("Missing required fields: studio and sale.");
  }

  const { user } = await requireUser();
  const result = await completePosCashSale({
    userId: user.id,
    studioId,
    saleId,
    idempotencyKey,
  });

  if (!result.ok) {
    console.log("completePosCashSaleAction failed", {
      code: result.code,
      message: result.message,
      studioId,
      saleId,
    });
    return err(mapPosMutationMessage(result.code, result.message || "Could not confirm cash payment."));
  }

  return {
    ok: true,
    message: result.payload.already_paid ? "Cash payment already confirmed." : "Cash payment confirmed.",
    payment_id: result.payload.payment_id,
    receipt_number: result.payload.receipt_number,
    sale_status: result.payload.sale_status,
  };
}

export async function voidPosSaleAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;

  if (!studioId || !saleId) {
    return err("Missing required fields: studio and sale.");
  }

  const { user } = await requireUser();
  const result = await voidPosSale({
    userId: user.id,
    studioId,
    saleId,
    reason,
    idempotencyKey,
  });

  if (!result.ok) {
    await recordPosOperationFailure({
      operation: "void_pos_sale",
      code: "void_pos_sale_failed",
      detail: `${result.code}:${result.message}`,
      studioId,
      saleId,
      safePayload: {
        actor_id: user.id,
        reason,
        idempotency_key: idempotencyKey,
      },
    });
    return err(mapPosMutationMessage(result.code, result.message || "Could not void POS sale."));
  }

  if (result.payload.already_voided) {
    return ok("Sale already voided.");
  }
  return ok("Sale voided.");
}

export async function refundPosSaleItemsAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const saleId = String(formData.get("sale_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;

  if (!studioId || !saleId) {
    return err("Missing required fields: studio and sale.");
  }

  if (!reason) {
    return err("Refund reason is required.");
  }

  const parsedItems = parseRefundItems(formData);
  if (!parsedItems.ok) {
    return err(parsedItems.message);
  }

  const { user } = await requireUser();
  const result = await refundPosSaleItems({
    userId: user.id,
    studioId,
    saleId,
    items: parsedItems.items,
    reason,
    idempotencyKey,
  });

  if (!result.ok) {
    await recordPosOperationFailure({
      operation: "refund_pos_sale_items",
      code: "refund_pos_sale_items_failed",
      detail: `${result.code}:${result.message}`,
      studioId,
      saleId,
      safePayload: {
        actor_id: user.id,
        reason,
        idempotency_key: idempotencyKey,
        item_count: parsedItems.items.length,
      },
    });
    return err(mapPosMutationMessage(result.code, result.message || "Could not refund POS sale items."));
  }

  if (result.payload.already_completed) {
    return ok("Refund request already completed.");
  }

  if (result.payload.sale_status === "refunded") {
    return ok("Sale fully refunded.");
  }

  return ok(`Refund applied to ${result.payload.item_count} item(s).`);
}

export async function openPosCashSessionAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const locationId = String(formData.get("location_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;
  const openingFloat = asNumberOrNull(formData.get("opening_float"));

  if (!studioId || !locationId) {
    return err("Missing required fields: studio and location.");
  }

  if (openingFloat != null && openingFloat < 0) {
    return err("Opening float must be zero or positive.");
  }

  const { user } = await requireUser();
  const result = await openPosCashSession({
    userId: user.id,
    studioId,
    locationId,
    openingFloat,
    notes,
    idempotencyKey,
  });

  if (!result.ok) {
    return err(mapPosMutationMessage(result.code, result.message || "Could not open cash session."));
  }

  return ok("Cash session opened.");
}

export async function closePosCashSessionAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
  const studioId = String(formData.get("studio_id") ?? "").trim();
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || null;
  const countedCash = asNumberOrNull(formData.get("counted_cash"));

  if (!studioId || !sessionId) {
    return err("Missing required fields: studio and cash session.");
  }

  if (countedCash == null) {
    return err("Counted cash is required.");
  }
  if (countedCash < 0) {
    return err("Counted cash must be zero or positive.");
  }

  const { user } = await requireUser();
  const result = await closePosCashSession({
    userId: user.id,
    studioId,
    sessionId,
    countedCash,
    notes,
    idempotencyKey,
  });

  if (!result.ok) {
    return err(mapPosMutationMessage(result.code, result.message || "Could not close cash session."));
  }

  if (result.payload.already_closed) {
    return ok("Cash session already closed.");
  }
  return ok("Cash session closed.");
}
