// Customer self-confirmation has been removed from the payment flow.
// Payments are confirmed exclusively by staff (via /api/payment/mark)
// or by automatic reference matching.
export async function POST() {
  return Response.json(
    { error: "deprecated", message: "Customer confirmation is no longer required." },
    { status: 410 },
  );
}
