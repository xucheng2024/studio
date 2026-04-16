import { createAdminClient } from "@/lib/supabase/admin";

export async function writeOperationAudit(params: {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("operation_audits").insert({
      actor_id: params.actorId ?? null,
      actor_role: params.actorRole ?? null,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId ?? null,
      before_state: params.beforeState ?? null,
      after_state: params.afterState ?? null,
    });
  } catch {
    // best effort audit write
  }
}
