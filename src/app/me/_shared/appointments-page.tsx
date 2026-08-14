import { formatLocalDateTime, toLocalDateTimeInputValue } from "@/lib/date";
import { ui } from "@/lib/ui";
import { cancelSelfAppointment, listSelfAppointments, parseRescheduleDatetime, rescheduleSelfAppointment } from "@/lib/salon-appointments-self";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeStudioSlug } from "@/lib/slug";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMeUser, requireStudioScope, type MePageScope } from "./context";

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

async function resolveStudioId(studioSlug: string | null) {
  if (!studioSlug) return null;
  const scoped = await requireStudioScope(studioSlug);
  return scoped.studio.id;
}

export async function renderAppointmentsPage(scope?: MePageScope) {
  const studioSlug = normalizeStudioSlug(scope?.studioSlug ?? "");
  const { user } = await requireMeUser(scope, "appointments");
  const studioId = await resolveStudioId(studioSlug || null);

  if (!studioId) {
    return (
      <main className={ui.page}>
        <div className="mx-auto max-w-2xl space-y-3">
          <h1 className={ui.h1}>My appointments</h1>
          <p className={ui.muted}>Please open this page under a studio, for example `/{'{studioSlug}'}/me/appointments`.</p>
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
    const appointmentId = String(formData.get("appointment_id") ?? "").trim();
    const reason = String(formData.get("reason") ?? "customer_cancelled").trim() || "customer_cancelled";
    const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || crypto.randomUUID();
    if (!appointmentId) {
      redirect(`${myAppointmentsPath}?error=missing_appointment`);
    }

    const operation = await cancelSelfAppointment({
      userId: user.id,
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
    const appointmentId = String(formData.get("appointment_id") ?? "").trim();
    const datetimeLocal = String(formData.get("new_starts_at") ?? "").trim();
    const reason = String(formData.get("reason") ?? "customer_rescheduled").trim() || "customer_rescheduled";
    const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || crypto.randomUUID();

    const parsed = parseRescheduleDatetime(datetimeLocal);
    if (!appointmentId || !parsed) {
      redirect(`${myAppointmentsPath}?error=invalid_datetime`);
    }

    const operation = await rescheduleSelfAppointment({
      userId: user.id,
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
                        type="hidden"
                        name="idempotency_key"
                        value={`apt04-reschedule:${appointment.id}:${appointment.updated_at}`}
                      />
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
                      <input type="hidden" name="idempotency_key" value={`apt04-cancel:${appointment.id}:${appointment.updated_at}`} />
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
