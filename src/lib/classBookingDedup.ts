import type { SupabaseClient } from "@supabase/supabase-js";

/** True when this identity already holds a non-cancelled seat for the session. */
export async function classGuestHasActiveBooking(
  admin: SupabaseClient,
  sessionId: string,
  guestEmail: string,
): Promise<boolean> {
  const email = guestEmail.trim().toLowerCase();
  if (!email) return false;

  const { data: guestRows } = await admin
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("guest_email", email)
    .neq("status", "cancelled")
    .limit(1);
  if ((guestRows?.length ?? 0) > 0) return true;

  const { data: userRow } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!userRow?.id) return false;

  const { data: clientRows } = await admin
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("client_id", userRow.id)
    .neq("status", "cancelled")
    .limit(1);

  return (clientRows?.length ?? 0) > 0;
}
