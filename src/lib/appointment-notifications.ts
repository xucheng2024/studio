import "server-only";

import {
  sendAppointmentNotificationEmail,
  type AppointmentEmailEventType,
} from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildAppointmentNotificationDedupeKey,
  mapTransitionStatusToAppointmentNotificationEvent,
  type AppointmentNotificationEventType,
  type AppointmentNotificationQueueStatus,
} from "@/lib/appointment-notification-rules";

export type { AppointmentNotificationEventType, AppointmentNotificationQueueStatus };
export { mapTransitionStatusToAppointmentNotificationEvent };

type AppointmentNotificationQueueRow = {
  id: string;
  studio_id: string;
  location_id: string;
  appointment_id: string;
  event_type: AppointmentNotificationEventType;
  channel: "email";
  dedupe_key: string;
  recipient_email: string | null;
  payload: Record<string, unknown> | null;
  scheduled_for: string;
  status: AppointmentNotificationQueueStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  claim_token: string;
  claimed_at: string | null;
  processed_by: string | null;
  sent_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  created_at: string;
  updated_at: string;
};

export async function enqueueAppointmentEmailNotification(params: {
  studioId: string;
  appointmentId: string;
  eventType: AppointmentNotificationEventType;
  idempotencyKey: string;
  actorId?: string | null;
  actorRole?: string | null;
  idempotencyRecordId?: string | null;
  scheduledForIso?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  const admin = createAdminClient();
  const dedupeKey = buildAppointmentNotificationDedupeKey({
    studioId: params.studioId,
    appointmentId: params.appointmentId,
    eventType: params.eventType,
    idempotencyKey: params.idempotencyKey,
  });

  const { data, error } = await admin.rpc("enqueue_appointment_notification_email", {
    p_studio_id: params.studioId,
    p_appointment_id: params.appointmentId,
    p_event_type: params.eventType,
    p_dedupe_key: dedupeKey,
    p_scheduled_for: params.scheduledForIso ?? null,
    p_payload: params.payload ?? {},
    p_actor_id: params.actorId ?? null,
    p_actor_role: params.actorRole ?? null,
    p_idempotency_key_id: params.idempotencyRecordId ?? null,
  });

  if (error) throw error;
  return data as {
    ok: boolean;
    deduped?: boolean;
    job_id?: string | null;
    status?: AppointmentNotificationQueueStatus;
    invalidated_reminder_count?: number;
  };
}

export async function enqueueAppointmentEmailNotificationSafe(params: {
  studioId: string;
  appointmentId: string;
  eventType: AppointmentNotificationEventType;
  idempotencyKey: string;
  actorId?: string | null;
  actorRole?: string | null;
  idempotencyRecordId?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  try {
    return await enqueueAppointmentEmailNotification(params);
  } catch (error) {
    console.error("[apt05] enqueue appointment email notification failed", {
      studioId: params.studioId,
      appointmentId: params.appointmentId,
      eventType: params.eventType,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listAppointmentEmailNotificationJobs(params: {
  studioId: string;
  locationId?: string | null;
  appointmentId?: string | null;
  statuses?: AppointmentNotificationQueueStatus[] | null;
  limit?: number;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("list_appointment_notification_email_jobs", {
    p_studio_id: params.studioId,
    p_location_id: params.locationId ?? null,
    p_appointment_id: params.appointmentId ?? null,
    p_statuses: params.statuses && params.statuses.length > 0 ? params.statuses : null,
    p_limit: params.limit ?? 100,
  });
  if (error) throw error;
  return (data ?? []) as AppointmentNotificationQueueRow[];
}

export async function getAppointmentEmailNotificationJob(params: {
  studioId: string;
  jobId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("appointment_notification_queue")
    .select("id, studio_id, location_id, status")
    .eq("id", params.jobId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{ id: string; studio_id: string; location_id: string; status: AppointmentNotificationQueueStatus }>();
  if (error) throw error;
  return data;
}

export async function retryAppointmentEmailNotificationJob(params: {
  studioId: string;
  jobId: string;
  actorId?: string | null;
  actorRole?: string | null;
}) {
  const job = await getAppointmentEmailNotificationJob({
    studioId: params.studioId,
    jobId: params.jobId,
  });
  if (!job) return { ok: false as const, reason: "not_found" as const };

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("retry_appointment_notification_email_job", {
    p_job_id: params.jobId,
    p_actor_id: params.actorId ?? null,
    p_actor_role: params.actorRole ?? null,
  });

  if (error) throw error;
  return {
    ok: true as const,
    job,
    result: data as {
      ok: boolean;
      reason?: string;
      status?: AppointmentNotificationQueueStatus;
      job_id?: string;
      already_final?: boolean;
      attempt_count?: number;
      next_attempt_at?: string;
    },
  };
}

async function claimAppointmentEmailJobs(params: { batchSize: number; workerId: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_appointment_notification_email_jobs", {
    p_batch_size: params.batchSize,
    p_worker_id: params.workerId,
    p_stale_after_seconds: 300,
  });
  if (error) throw error;
  return (data ?? []) as AppointmentNotificationQueueRow[];
}

async function completeAppointmentEmailJob(params: {
  jobId: string;
  claimToken: string;
  deliveryMeta?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_appointment_notification_email_job", {
    p_job_id: params.jobId,
    p_claim_token: params.claimToken,
    p_delivery_meta: params.deliveryMeta ?? {},
  });
  if (error) throw error;
  return data as { ok: boolean; reason?: string };
}

async function failAppointmentEmailJob(params: {
  jobId: string;
  claimToken: string;
  errorSummary: string;
  retryable?: boolean;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_appointment_notification_email_job", {
    p_job_id: params.jobId,
    p_claim_token: params.claimToken,
    p_error_summary: params.errorSummary,
    p_retryable: params.retryable ?? true,
    p_base_delay_seconds: 60,
    p_max_delay_seconds: 3600,
  });
  if (error) throw error;
  return data as { ok: boolean; reason?: string; status?: AppointmentNotificationQueueStatus };
}

async function resolveAppointmentEmailContext(params: {
  studioId: string;
  appointmentId: string;
}) {
  const admin = createAdminClient();

  const { data: appointment, error: appointmentError } = await admin
    .from("salon_appointments")
    .select(
      "id, studio_id, salon_customer_id, status, starts_at, service_title_snapshot, location_name_snapshot",
    )
    .eq("id", params.appointmentId)
    .eq("studio_id", params.studioId)
    .maybeSingle<{
      id: string;
      studio_id: string;
      salon_customer_id: string;
      status: string;
      starts_at: string;
      service_title_snapshot: string;
      location_name_snapshot: string;
    }>();

  if (appointmentError) throw appointmentError;
  if (!appointment) return null;

  const [{ data: customer, error: customerError }, { data: studio, error: studioError }] = await Promise.all([
    admin
      .from("salon_customers")
      .select("id, full_name, email")
      .eq("id", appointment.salon_customer_id)
      .eq("studio_id", params.studioId)
      .maybeSingle<{ id: string; full_name: string | null; email: string | null }>(),
    admin
      .from("studios")
      .select("id, name")
      .eq("id", params.studioId)
      .maybeSingle<{ id: string; name?: string | null }>(),
  ]);

  if (customerError) throw customerError;
  if (studioError) throw studioError;

  return {
    appointment,
    customer,
    studioName: studio?.name?.trim() || "Studio",
  };
}

async function sendOneAppointmentEmailJob(job: AppointmentNotificationQueueRow) {
  if (!job.recipient_email) {
    return { ok: false as const, retryable: false, error: "missing_recipient_email" };
  }

  const context = await resolveAppointmentEmailContext({
    studioId: job.studio_id,
    appointmentId: job.appointment_id,
  });

  if (!context || !context.customer) {
    return { ok: false as const, retryable: false, error: "appointment_or_customer_not_found" };
  }

  const eventType = job.event_type as AppointmentEmailEventType;
  const sent = await sendAppointmentNotificationEmail({
    to: job.recipient_email,
    eventType,
    studioName: context.studioName,
    customerName: context.customer.full_name,
    serviceName: context.appointment.service_title_snapshot,
    locationName: context.appointment.location_name_snapshot,
    startsAtIso: context.appointment.starts_at,
  });

  if (sent.skipped) {
    return {
      ok: false as const,
      retryable: Boolean(sent.error),
      error: sent.error ?? "email_provider_not_configured",
    };
  }

  return { ok: true as const };
}

export async function processAppointmentEmailNotificationBatch(params?: {
  batchSize?: number;
  workerId?: string;
}) {
  const batchSize = Math.max(1, Math.min(100, params?.batchSize ?? 30));
  const workerId = params?.workerId?.trim() || "appointment-email-cron";

  const claimed = await claimAppointmentEmailJobs({ batchSize, workerId });

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const job of claimed) {
    try {
      const result = await sendOneAppointmentEmailJob(job);
      if (result.ok) {
        const completed = await completeAppointmentEmailJob({
          jobId: job.id,
          claimToken: job.claim_token,
          deliveryMeta: { delivered_at: new Date().toISOString() },
        });
        if (!completed.ok) {
          failed += 1;
          continue;
        }
        sent += 1;
        continue;
      }

      const failedResult = await failAppointmentEmailJob({
        jobId: job.id,
        claimToken: job.claim_token,
        errorSummary: result.error,
        retryable: result.retryable,
      });

      if (failedResult.ok && failedResult.status === "pending") {
        retried += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failAppointmentEmailJob({
        jobId: job.id,
        claimToken: job.claim_token,
        errorSummary: message,
        retryable: true,
      }).catch(() => undefined);
      failed += 1;
    }
  }

  return {
    claimed: claimed.length,
    sent,
    failed,
    retried,
  };
}
