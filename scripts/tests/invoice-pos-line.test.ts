import assert from "node:assert/strict";
import test from "node:test";
import { formatPosInvoiceLineItem } from "../../src/lib/invoice-pos-line.ts";

test("POS invoice line uses receipt and first three items", () => {
  assert.equal(
    formatPosInvoiceLineItem({
      receiptNumber: "R-100",
      saleNumber: "S-9",
      itemNames: ["Cut", "Colour", "Blow", "Oil"],
    }),
    "POS receipt R-100: Cut, Colour, Blow +1 more",
  );
});

test("POS invoice line falls back when the sale has no named items", () => {
  assert.equal(
    formatPosInvoiceLineItem({ receiptNumber: null, saleNumber: null, itemNames: ["", "  "] }),
    "POS sale",
  );
});
