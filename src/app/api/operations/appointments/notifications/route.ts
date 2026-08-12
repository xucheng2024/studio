import { NextResponse } from "next/server";
import {
  getAppointmentEmailNotificationJob,
  listAppointmentEmailNotificationJobs,
  retryAppointmentEmailNotificationJob,
  type AppointmentNotificationQueueStatus,
} from "@/lib/appointment-notifications";
import {
  requireGlobalStaffScope,
  requireStaffScope,
  staffScopeFailureResponse,
} from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const STATUS_SET = new Set<AppointmentNotificationQueueStatus>([
  "pending",
  "processing",
  "sent",
  "failed",
  "invalidated",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const studioId = (url.searchParams.get("studio_id") ?? "").trim();
  const locationId = (url.searchParams.get("location_id") ?? "").trim() || null;
  const appointmentId = (url.searchParams.get("appointment_id") ?? "").trim() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 100;

  const statuses = (url.searchParams.get("statuses") ?? "")
    .split(",")
    .map((status) => status.trim())
    .filter((status): status is AppointmentNotificationQueueStatus => STATUS_SET.has(status as AppointmentNotificationQueueStatus));

  if (!studioId) {
    return NextResponse.json({ error: "studio_id_required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (locationId) {
    const scoped = await requireStaffScope({
      userId: user.id,
      studioId,
      locationId,
      roles: ["owner", "manager", "frontdesk"],
    });
    if (!scoped.ok) return staffScopeFailureResponse(scoped);
  } else {
    const scoped = await requireGlobalStaffScope({
      userId: user.id,
      studioId,
      roles: ["owner", "manager", "frontdesk"],
    });
    if (!scoped.ok) return staffScopeFailureResponse(scoped);
  }

  const rows = await listAppointmentEmailNotificationJobs({
    studioId,
    locationId,
    appointmentId,
    statuses: statuses.length > 0 ? statuses : null,
    limit,
  });

  return NextResponse.json({
    rows,
    count: rows.length,
  });
}

export async function POST(req: Request) {
  let body: { studio_id?: string; job_id?: string } = {};
  try {
    body = (await req.json()) as { studio_id?: string; job_id?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const studioId = (body.studio_id ?? "").trim();
  const jobId = (body.job_id ?? "").trim();
  if (!studioId || !jobId) {
    return NextResponse.json({ error: "studio_id_and_job_id_required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const job = await getAppointmentEmailNotificationJob({ studioId, jobId });
  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId,
    locationId: job.location_id,
    roles: ["owner", "manager"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const retried = await retryAppointmentEmailNotificationJob({
    studioId,
    jobId,
    actorId: user.id,
    actorRole: scoped.role,
  });

  if (!retried.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!retried.result.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: retried.result.reason ?? "retry_rejected",
        status: retried.result.status ?? null,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    job_id: retried.result.job_id ?? jobId,
    status: retried.result.status ?? "pending",
    already_final: Boolean(retried.result.already_final),
    attempt_count: retried.result.attempt_count ?? null,
    next_attempt_at: retried.result.next_attempt_at ?? null,
  });
}
