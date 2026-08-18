import assert from "node:assert/strict";
import test from "node:test";
import { appointmentWhatsappText, whatsappDigits, whatsappHref } from "../../src/lib/whatsapp.ts";

test("accepts E.164 and local Singapore mobiles", () => {
  assert.equal(whatsappDigits("+65 9123 4567"), "6591234567");
  assert.equal(whatsappDigits("91234567"), "6591234567");
  assert.equal(whatsappDigits("+1 (415) 555-2671"), "14155552671");
  assert.equal(whatsappDigits("+65"), null);
  assert.equal(whatsappDigits(null), null);
});

test("builds a wa.me link with prefilled text", () => {
  const href = whatsappHref("+6591234567", "Hi Amy, confirming tomorrow 2:00pm.");
  assert.equal(href, "https://wa.me/6591234567?text=Hi%20Amy%2C%20confirming%20tomorrow%202%3A00pm.");
});

test("pending appointments ask the customer to confirm", () => {
  const text = appointmentWhatsappText({
    customerName: "Amy",
    serviceTitle: "Facial",
    locationName: "Orchard",
    startsAt: "2026-08-19T02:00:00.000Z",
    status: "pending",
  });
  assert.match(text, /Hi Amy, confirming your Facial on/);
  assert.match(text, /at Orchard/);
  assert.match(text, /Reply YES to confirm/);
});
