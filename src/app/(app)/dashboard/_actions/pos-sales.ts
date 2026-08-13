"use server";

import {
  completePosCashSale,
  createPosSaleDraft,
  ensurePosSalePayment,
  lockPosSale,
  upsertPosSaleItem,
  voidPosSale,
} from "@/lib/pos-sales";
import { mapPosMutationMessage } from "@/lib/pos-error-message";
import { err, ok, requireUser, type DashboardFormResult } from "./shared";

export type PosProceedToPaymentResult = DashboardFormResult & {
  payment_id?: string;
  payment_reference_code?: string | null;
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

export async function createPosSaleDraftAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
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
    return err(mapPosMutationMessage(result.code, result.message || "Could not create POS draft."));
  }

  return ok(result.payload.already_completed ? "POS draft already created." : "POS draft created.");
}

export async function upsertPosSaleItemAction(
  _prevState: DashboardFormResult | null,
  formData: FormData,
): Promise<DashboardFormResult> {
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
    return err(mapPosMutationMessage(result.code, result.message || "Could not save POS item."));
  }

  return ok(result.payload.item_action === "updated" ? "POS item updated." : "POS item created.");
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
): Promise<DashboardFormResult> {
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
    return err(mapPosMutationMessage(result.code, result.message || "Could not confirm cash payment."));
  }

  if (result.payload.already_paid) {
    return ok("Cash payment already confirmed.");
  }
  return ok("Cash payment confirmed.");
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
    return err(mapPosMutationMessage(result.code, result.message || "Could not void POS sale."));
  }

  if (result.payload.already_voided) {
    return ok("Sale already voided.");
  }
  return ok("Sale voided.");
}
