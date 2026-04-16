import { createAdminClient } from "@/lib/supabase/admin";

export async function mergeGuestRecordsForUser(userId: string, email?: string | null) {
  if (!userId || !email) return;
  const admin = createAdminClient();
  await admin.rpc("merge_guest_records_for_user", {
    p_user_id: userId,
    p_email: email,
  });
}
