import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formatLocalDateTime, toLocalDateTimeInputValue } from "@/lib/date";
import { normalizeStudioSlug } from "@/lib/slug";
import {
  cancelSelfAppointment,
  listSelfAppointments,
  parseRescheduleDatetime,
  rescheduleSelfAppointment,
} from "@/lib/salon-appointments-self";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";
import {
  getActiveMemberStudioSlugFromCookie,
  requireMeUser,
  requireStudioScope,
  type MePageScope,
} from "./context";

type FeedbackParams = {
  ok?: string;
  error?: string;
};

function badgeClass(status: string) {
  if (status === "completed") return ui.badge;
  if (status === "cancelled" || status === "no_show") return ui.badgeRed;
  if (status === "pending") return ui.badgeAmber;
  return ui.badgeNeutral;
}

function getScopedPath(studioSlug: string | null, section: string) {
  if (studioSlug) return `/${studioSlug}/me/${section}`;
  return `/me/${section}`;
}

function getFeedbackMessage(feedback?: FeedbackParams) {
  const ok = String(feedback?.ok ?? "").trim();
  const error = String(feedback?.error ?? "").trim();
  if (ok === "booked") return { tone: "ok" as const, text: "Appointment submitted successfully." };
  if (ok === "rescheduled") return { tone: "ok" as const, text: "Appointment rescheduled." };
  if (ok === "cancelled") return { tone: "ok" as const, text: "Appointment cancelled." };
  if (!error) return null;
  const map: Record<string, string> = {
    missing_appointment: "Appointment id is missing.",
    invalid_datetime: "Please select a valid date and time.",
    forbidden: "You can only operate your own appointments.",
    slot_conflict: "Selected slot conflicts with another booking.",
    resource_conflict: "Required room/resource is unavailable.",
    invalid_request: "Invalid request. Please refresh and retry.",
    idempotency_conflict: "Duplicate request payload mismatch detected.",
    idempotency_in_progress: "Request is in progress. Please retry shortly.",
    not_found: "Appointment not found.",
  };
  return { tone: "error" as const, text: map[error] ?? `Operation failed (${error}).` };
}

async function resolveStudioId(studioSlug: string | null) {
  if (!studioSlug) return null;
  const scoped = await requireStudioScope(studioSlug);
  return scoped.studio.id;
}

export async function renderAppointmentsPage(scope?: MePageScope, feedback?: FeedbackParams) {
  const studioSlug = normalizeStudioSlug(scope?.studioSlug ?? "");
  const { user } = await requireMeUser(scope, "appointments");
  const studioId = await resolveStudioId(studioSlug || null);
  const notice = getFeedbackMessage(feedback);

  if (!studioId) {
    const admin = createAdminClient();
    const activeStudioSlug = await getActiveMemberStudioSlugFromCookie();
    if (activeStudioSlug) {
      const { data: activeStudio } = await admin
        .from("studios")
        .select("id")
        .eq("public_slug", activeStudioSlug)
        .maybeSingle<{ id: string }>();
      if (activeStudio?.id) {
        const { data: activeCustomer } = await admin
          .from("salon_customers")
          .select("id")
          .eq("studio_id", activeStudio.id)
          .eq("user_id", user.id)
          .is("merged_into_id", null)
          .eq("status", "active")
          .maybeSingle<{ id: string }>();
        if (activeCustomer?.id) {
          redirect(`/${activeStudioSlug}/me/appointments`);
        }
      }
    }

    const { data: customerRows, error: customerError } = await admin
      .from("salon_customers")
      .select("id, studio_id")
      .eq("user_id", user.id)
      .is("merged_into_id", null)
      .eq("status", "active");
    if (customerError) throw customerError;

    const customerIds = (customerRows ?? []).map((row) => row.id);
    const studioIds = Array.from(new Set((customerRows ?? []).map((row) => row.studio_id)));

    const [{ data: studioRows, error: studioError }, { data: appointmentRows, error: appointmentError }] =
      await Promise.all([
        studioIds.length
          ? admin.from("studios").select("id, name, public_slug").in("id", studioIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; public_slug: string | null }>, error: null }),
        customerIds.length
          ? admin
              .from("salon_appointments")
              .select(
                "id, studio_id, salon_customer_id, status, starts_at, service_title_snapshot, employee_name_snapshot, location_name_snapshot",
              )
              .in("salon_customer_id", customerIds)
              .order("starts_at", { ascending: false })
          : Promise.resolve({
              data: [] as Array<{
                id: string;
                studio_id: string;
                salon_customer_id: string;
                status: string;
                starts_at: string;
                service_title_snapshot: string;
                employee_name_snapshot: string;
                location_name_snapshot: string;
              }>,
              error: null,
            }),
      ]);

    if (studioError) throw studioError;
    if (appointmentError) throw appointmentError;

    const studioMap = new Map((studioRows ?? []).map((row) => [row.id, row]));

    return (
      <main className={ui.page}>
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className={ui.h1}>My appointments</h1>
            <p className={ui.muted}>Showing your appointments across all studios.</p>
          </div>

          {notice ? (
            <div className={`${ui.card} ${notice.tone === "ok" ? "border-teal-300" : "border-rose-300"}`}>
              <p className={notice.tone === "ok" ? "text-teal-700 dark:text-teal-300" : "text-rose-700 dark:text-rose-300"}>{notice.text}</p>
            </div>
          ) : null}

          {appointmentRows?.length ? (
            <ul className="space-y-3">
              {appointmentRows.map((appointment) => {
                const studio = studioMap.get(appointment.studio_id);
                const studioSlugValue = normalizeStudioSlug(studio?.public_slug ?? "");
                const openHref = studioSlugValue ? `/${studioSlugValue}/me/appointments` : null;
                return (
                  <li key={appointment.id} className={ui.card}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-stone-900 dark:text-stone-100">{appointment.service_title_snapshot}</p>
                        <p className={`text-sm ${ui.muted}`}>
                          {formatLocalDateTime(appointment.starts_at)} · {appointment.employee_name_snapshot} · {appointment.location_name_snapshot}
                        </p>
                        <p className={`mt-1 text-xs ${ui.muted}`}>Studio: {studio?.name ?? "Unknown"}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass(appointment.status)}`}>
                        {appointment.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    {openHref ? (
                      <div className="mt-3">
                        <a href={openHref} className={ui.btnSecondarySm}>Manage in studio page</a>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={ui.emptyState}>
              <p className={ui.muted}>No salon appointments found under your account.</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  const result = await listSelfAppointments({ studioId, userId: user.id });
  if (!result.ok) {
    return (
      <main className={ui.page}>
        <div className="mx-auto max-w-2xl space-y-3">
          <h1 className={ui.h1}>My appointments</h1>
          <p className={ui.muted}>Your account is not linked to a salon customer profile in this studio yet.</p>
        </div>
      </main>
    );
  }

  const myAppointmentsPath = getScopedPath(studioSlug || null, "appointments");

  async function cancelAction(formData: FormData) {
    "use server";
    const actionSupabase = await createClient();
    const {
      data: { user: actionUser },
    } = await actionSupabase.auth.getUser();
    if (!actionUser) {
      if (studioSlug) {
        redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/me/appointments`)}`);
      }
      redirect("/login");
    }

    const appointmentId = String(formData.get("appointment_id") ?? "").trim();
    const reason = String(formData.get("reason") ?? "customer_cancelled").trim() || "customer_cancelled";
    const idempotencyKey =
      String(formData.get("idempotency_key") ?? "").trim()
      || `apt04-cancel:${appointmentId}:${reason.toLowerCase().replace(/\s+/g, "_")}`;

    if (!appointmentId) {
      redirect(`${myAppointmentsPath}?error=missing_appointment`);
    }

    const operation = await cancelSelfAppointment({
      userId: actionUser.id,
      studioId,
      appointmentId,
      reason,
      idempotencyKey,
    });

    if (!operation.ok) {
      redirect(`${myAppointmentsPath}?error=${encodeURIComponent(operation.code)}`);
    }

    revalidatePath(myAppointmentsPath);
    redirect(`${myAppointmentsPath}?ok=cancelled`);
  }

  async function rescheduleAction(formData: FormData) {
    "use server";
    const actionSupabase = await createClient();
    const {
      data: { user: actionUser },
    } = await actionSupabase.auth.getUser();
    if (!actionUser) {
      if (studioSlug) {
        redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/me/appointments`)}`);
      }
      redirect("/login");
    }

    const appointmentId = String(formData.get("appointment_id") ?? "").trim();
    const datetimeLocal = String(formData.get("new_starts_at") ?? "").trim();
    const reason = String(formData.get("reason") ?? "customer_rescheduled").trim() || "customer_rescheduled";

    const parsed = parseRescheduleDatetime(datetimeLocal);
    if (!appointmentId || !parsed) {
      redirect(`${myAppointmentsPath}?error=invalid_datetime`);
    }

    const idempotencyKey =
      String(formData.get("idempotency_key") ?? "").trim()
      || `apt04-reschedule:${appointmentId}:${parsed.toISOString()}`;

    const operation = await rescheduleSelfAppointment({
      userId: actionUser.id,
      studioId,
      appointmentId,
      newStartsAtIso: parsed.toISOString(),
      reason,
      idempotencyKey,
    });

    if (!operation.ok) {
      redirect(`${myAppointmentsPath}?error=${encodeURIComponent(operation.code)}`);
    }

    revalidatePath(myAppointmentsPath);
    redirect(`${myAppointmentsPath}?ok=rescheduled`);
  }

  const studioLookup = new Map<string, { public_slug: string | null }>();
  {
    const admin = createAdminClient();
    const { data } = await admin
      .from("studios")
      .select("id, public_slug")
      .eq("id", studioId);
    for (const row of data ?? []) {
      studioLookup.set(row.id, { public_slug: row.public_slug ?? null });
    }
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className={ui.h1}>My appointments</h1>
          <p className={`mt-1 ${ui.muted}`}>Manage your own salon appointments.</p>
        </div>

        {notice ? (
          <div className={`${ui.card} ${notice.tone === "ok" ? "border-teal-300" : "border-rose-300"}`}>
            <p className={notice.tone === "ok" ? "text-teal-700 dark:text-teal-300" : "text-rose-700 dark:text-rose-300"}>{notice.text}</p>
          </div>
        ) : null}

        {!result.payload.appointments.length ? (
          <div className={ui.emptyState}>
            <p className={ui.muted}>No salon appointments yet.</p>
            {studioLookup.get(studioId)?.public_slug ? (
              <a href={`/${studioLookup.get(studioId)?.public_slug}/appointments`} className={ui.link}>
                Book an appointment →
              </a>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {result.payload.appointments.map((appointment) => {
              const canReschedule = ["pending", "confirmed"].includes(appointment.status);
              const canCancel = ["pending", "confirmed", "checked_in"].includes(appointment.status);
              return (
                <li key={appointment.id} className={ui.card}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-stone-900 dark:text-stone-100">{appointment.service_title_snapshot}</p>
                      <p className={`text-sm ${ui.muted}`}>
                        {formatLocalDateTime(appointment.starts_at)} · {appointment.employee_name_snapshot} · {appointment.location_name_snapshot}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass(appointment.status)}`}>
                      {appointment.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  {canReschedule ? (
                    <form action={rescheduleAction} className="mt-3 grid gap-2 sm:grid-cols-4">
                      <input type="hidden" name="appointment_id" value={appointment.id} />
                      <input
                        type="datetime-local"
                        name="new_starts_at"
                        className={`${ui.input} sm:col-span-2`}
                        defaultValue={toLocalDateTimeInputValue(appointment.starts_at)}
                        required
                      />
                      <input
                        type="text"
                        name="reason"
                        className={`${ui.input} sm:col-span-1`}
                        defaultValue="customer_rescheduled"
                      />
                      <button type="submit" className={`${ui.btnSecondarySm} sm:col-span-1`}>Reschedule</button>
                    </form>
                  ) : null}

                  {canCancel ? (
                    <form action={cancelAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                      <input type="hidden" name="appointment_id" value={appointment.id} />
                      <input
                        type="text"
                        name="reason"
                        className={`${ui.input} sm:col-span-3`}
                        defaultValue="customer_cancelled"
                        required
                      />
                      <button type="submit" className={`${ui.btnGhost} sm:col-span-1`}>Cancel</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
