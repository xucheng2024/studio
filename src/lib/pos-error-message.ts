import type { PosMutationErrorCode } from "@/lib/pos-sales";

function normalizeRawMessage(raw: string | null | undefined) {
  return (raw ?? "").trim();
}

export function mapPosMutationMessage(code: PosMutationErrorCode, rawMessage?: string | null) {
  const message = normalizeRawMessage(rawMessage);

  if (code === "idempotency_in_progress") {
    return "Same request is currently in progress. Please retry shortly.";
  }
  if (code === "idempotency_conflict") {
    return "Repeated request payload mismatch. Refresh and submit again.";
  }
  if (code === "idempotency_permanently_failed") {
    return "This request key is permanently failed. Please use a new idempotency key.";
  }
  if (code === "studio_not_found") {
    return "Studio not found.";
  }
  if (code === "studio_suspended") {
    return "Studio is suspended. Reactivate the contract first.";
  }
  if (code === "not_found") {
    return "Requested sale or item not found.";
  }
  if (code === "forbidden") {
    if (/location_out_of_scope/i.test(message)) {
      return "Selected location is outside your scope.";
    }
    return "You do not have permission for this POS operation.";
  }

  if (code === "invalid_request") {
    if (/empty items/i.test(message)) {
      return "Cannot proceed to payment for an empty sale. Add at least one item first.";
    }
    if (/totals mismatch/i.test(message)) {
      return "Sale totals do not match line items. Refresh items and retry payment.";
    }
    if (/missing snapshot name/i.test(message)) {
      return "One or more line items are missing required item snapshot names.";
    }
    if (/currency mismatch/i.test(message)) {
      return "One or more line items have a currency mismatch with the sale.";
    }
    if (/cannot be locked/i.test(message)) {
      return "Only draft sales can proceed to payment.";
    }
    if (/cannot be edited/i.test(message)) {
      return "Sale is already locked and cannot be edited.";
    }
    if (/not ready for payment/i.test(message)) {
      return "Sale is not in a payable state yet. Refresh and retry.";
    }
    if (/cannot complete cash sale/i.test(message)) {
      return "Only pending-payment sales can be marked as cash paid.";
    }
    if (/sale .*cannot be voided/i.test(message)) {
      return "Only draft or pending-payment sales can be voided.";
    }
    if (/payment .*cannot be voided/i.test(message)) {
      return "Linked payment is no longer pending, so this sale cannot be voided.";
    }
    if (/status .*cannot be refunded by items/i.test(message)) {
      return "Only paid or partially refunded sales can use item refund.";
    }
    if (/refund_amount exceeds remaining amount/i.test(message)) {
      return "Refund amount exceeds remaining refundable amount for one or more items.";
    }
    if (/refund_qty exceeds remaining qty/i.test(message)) {
      return "Refund quantity exceeds remaining refundable quantity for one or more items.";
    }
    if (/each refund item requires exactly one of refund_qty\/refund_amount/i.test(message)) {
      return "Each selected item must provide either refund quantity or refund amount (not both).";
    }
    if (/refund_qty must be > 0/i.test(message) || /refund_amount must be > 0/i.test(message)) {
      return "Refund quantity/amount must be greater than zero.";
    }
    if (/empty items payload/i.test(message)) {
      return "Select at least one item to refund.";
    }
    if (/payment .*not ready for item refund/i.test(message)) {
      return "Linked payment is not in a refundable state.";
    }
    if (/payment.*not ready/i.test(message)) {
      return "Linked payment is not in a payable state. Refresh and retry.";
    }
    if (/payment.*not found/i.test(message)) {
      return "No linked payment record found for this sale.";
    }
    if (/either item_id or line_number is required/i.test(message)) {
      return "Item update requires either item id or line number.";
    }
    if (/item_name_snapshot is required/i.test(message)) {
      return "Item name snapshot is required.";
    }
    if (/quantity must be > 0/i.test(message)) {
      return "Item quantity must be greater than zero.";
    }
    if (/unit_price_amount must be >= 0/i.test(message)) {
      return "Unit price must be zero or positive.";
    }
    if (/idempotency_key is required/i.test(message)) {
      return "Idempotency key is required.";
    }
    if (/request_hash is required/i.test(message)) {
      return "Request hash is required.";
    }
  }

  return message || "Could not process POS request.";
}
