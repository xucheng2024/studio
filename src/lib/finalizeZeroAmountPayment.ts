import type { SupabaseClient } from "@supabase/supabase-js";
import { applyHitpayPaymentRequestStatus } from "@/lib/hitpayApplyPaymentRequestStatus";

type ZeroAmountPaymentRow = {
  id: string;
  studio_id: string;
  booking_id?: string | null;
  event_booking_id?: string | null;
};

export async function finalizeZeroAmountPayment(
  admin: SupabaseClient,
  payment: ZeroAmountPaymentRow,
): Promise<void> {
  const { data: studio } = await admin
    .from("studios")
    .select("owner_id")
    .eq("id", payment.studio_id)
    .maybeSingle<{ owner_id?: string | null }>();

  await applyHitpayPaymentRequestStatus(admin, payment, studio, "paid", null, null);
}
