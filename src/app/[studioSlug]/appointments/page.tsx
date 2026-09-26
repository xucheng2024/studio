import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import Link from "next/link";
import { formatLocalDate, formatLocalTime, localISODate, shiftLocalIsoDate } from "@/lib/date";
import {
  createSelfAppointment,
  ensureSelfSalonCustomer,
  canCustomerChangeAppointment,
  getLatestSalonTermsVersion,
  getSelfBookingRules,
  getSelfOnlinePaymentOptions,
  groupSlotsByStartTime,
  lastSelfBookableDate,
  listSelfAppointments,
  listSelfBookableCatalog,
  listSelfBookableSlots,
  listSelfEligiblePackageCredits,
  rescheduleSelfAppointment,
  summarizeTermsSnapshot,
  type SelfBookableSlot,
} from "@/lib/salon-appointments-self";
import { getLatestPrivacyNotice, recordSelfPrivacyNoticeConsent } from "@/lib/studio-privacy";
import { normalizeStudioSlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/lib/ui";

type Props = {
  params: Promise<{ studioSlug: string }>;
  searchParams: Promise<{
    service_id?: string;
    location_id?: string;
    employee_id?: string;
    date?: string;
    starts_at?: string;
    reschedule?: string;
    error?: string;
    ok?: string;
  }>;
};

type BookingState = {
  locationId: string;
  serviceId: string;
  employeeId: string;
  date: string;
  startsAt: string;
  reschedule: string;
};

const chipBase = "inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 text-sm font-medium transition";
const chipIdle = `${chipBase} border-stone-200 bg-white text-stone-700 hover:border-teal-400 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200`;
const chipActive = `${chipBase} border-teal-600 bg-teal-600 text-white`;
const stepBadge = "flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white";

function messageFromStatus(ok: string | undefined, error: string | undefined) {
  if (ok === "booked") {
    return { tone: "ok" as const, text: "Appointment booked." };
  }
  if (!error) return null;
  const map: Record<string, string> = {
    missing_fields: "Please select a service and a time.",
    terms_required: "Please accept the Terms & Conditions before booking.",
    terms_version_stale: "Terms & Conditions have been updated. Please review the latest version and submit again.",
    privacy_required: "Please accept the privacy notice before booking.",
    privacy_version_stale: "The privacy notice has been updated. Please review the latest version and submit again.",
    privacy_consent_failed: "Could not record privacy notice consent. Please try again.",
    invalid_slot: "The selected time is invalid.",
    forbidden: "Your account is not linked to this studio customer profile.",
    slot_conflict: "This time was just taken. Please choose another one.",
    resource_conflict: "Required room/resource is unavailable for this time.",
    invalid_request: "Request is invalid. Please refresh and retry.",
    idempotency_in_progress: "A similar request is processing. Try again shortly.",
    idempotency_conflict: "Duplicate request mismatch detected. Please retry.",
    insufficient_credits: "No eligible package credits are available for this location.",
    package_not_eligible: "Package credits are not eligible for this appointment.",
    payment_option_unavailable: "That payment option is not available for this service. Please choose another.",
    payment_create_failed: "Could not create online payment request. Please try again.",
    payment_config_missing: "Studio online payment is not configured.",
    not_reschedulable: "This appointment can no longer be rescheduled online. Please contact the studio.",
    not_online_bookable: "This service can no longer be booked online. Please contact the studio.",
    outside_booking_window: "That time is outside the studio's online booking window. Please choose another.",
    change_cutoff_passed: "Online changes are closed for this appointment. Please contact the studio.",
  };
  return { tone: "error" as const, text: map[error] ?? `Booking failed (${error}).` };
}

function bookingHref(studioSlug: string, state: BookingState, patch: Partial<BookingState>) {
  const next = { ...state, ...patch };
  const query = new URLSearchParams();
  if (next.reschedule) query.set("reschedule", next.reschedule);
  if (next.locationId) query.set("location_id", next.locationId);
  if (next.serviceId) query.set("service_id", next.serviceId);
  if (next.employeeId) query.set("employee_id", next.employeeId);
  if (next.date) query.set("date", next.date);
  if (next.startsAt) query.set("starts_at", next.startsAt);
  const qs = query.toString();
  return `/${studioSlug}/appointments${qs ? `?${qs}` : ""}`;
}

function withError(href: string, code: string) {
  return `${href}${href.includes("?") ? "&" : "?"}error=${encodeURIComponent(code)}`;
}

function sgtHour(iso: string) {
  return (new Date(iso).getUTCHours() + 8) % 24;
}

function formatMoney(amount: number, currency: string) {
  return `${currency} ${amount.toFixed(2)}`;
}

/** Re-resolve a bookable slot on the server; "any staff" picks the first available option. */
async function resolveSlot(params: {
  studioId: string;
  locationId: string;
  serviceId: string;
  startsAtIso: string;
  employeeId: string;
  minNoticeMinutes: number;
  ignoreAppointmentId?: string;
}): Promise<SelfBookableSlot | null> {
  const startsAt = new Date(params.startsAtIso);
  if (Number.isNaN(startsAt.getTime())) return null;
  try {
    const result = await listSelfBookableSlots({
      studioId: params.studioId,
      locationId: params.locationId,
      serviceId: params.serviceId,
      dateYmd: localISODate(startsAt),
      ignoreAppointmentId: params.ignoreAppointmentId,
      minLeadMinutes: params.minNoticeMinutes,
      alignToClock: true,
    });
    if (!result.ok) return null;
    const startsAtMs = startsAt.getTime();
    return result.payload.slots.find(
      (slot) => new Date(slot.startsAtIso).getTime() === startsAtMs
        && (!params.employeeId || slot.employeeId === params.employeeId),
    ) ?? null;
  } catch {
    return null;
  }
}

export default async function StudioAppointmentsBookingPage({ params, searchParams }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const sp = await searchParams;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  if (!studioSlug) redirect("/");
  const slug: string = studioSlug;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/appointments`)}`);
  }

  await mergeGuestRecordsForUser(user.id, user.email);

  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, public_slug")
    .eq("public_slug", studioSlug)
    .maybeSingle<{ id: string; name: string; public_slug: string }>();
  if (!studio?.id) redirect("/");

  const selfCustomer = await ensureSelfSalonCustomer({ studioId: studio.id, userId: user.id });
  const studioId = studio.id;
  const myAppointmentsPath = `/${studioSlug}/me/appointments`;
  const [catalog, rules] = await Promise.all([
    listSelfBookableCatalog({ studioId: studio.id }),
    getSelfBookingRules({ studioId: studio.id }),
  ]);

  const rescheduleId = String(sp.reschedule ?? "").trim();
  const rescheduleAppointment = rescheduleId && selfCustomer.ok
    ? await listSelfAppointments({ studioId, userId: user.id }).then((result) =>
        result.ok ? result.payload.appointments.find((row) => row.id === rescheduleId) ?? null : null,
      )
    : null;
  if (rescheduleId && (!rescheduleAppointment || !["pending", "confirmed"].includes(rescheduleAppointment.status))) {
    redirect(`${myAppointmentsPath}?error=not_found`);
  }
  if (rescheduleAppointment && !canCustomerChangeAppointment(rules, rescheduleAppointment.starts_at)) {
    redirect(`${myAppointmentsPath}?error=change_cutoff_passed`);
  }
  const isReschedule = Boolean(rescheduleAppointment);

  const selectedLocationId = rescheduleAppointment?.location_id
    ?? (String(sp.location_id ?? "").trim() || (catalog.locations.length === 1 ? catalog.locations[0].id : ""));
  const selectedLocation = catalog.locations.find((location) => location.id === selectedLocationId) ?? null;
  const servicesAtLocation = selectedLocation
    ? catalog.services.filter((service) => service.locationIds.includes(selectedLocation.id))
    : [];
  const selectedServiceId = rescheduleAppointment?.service_id
    ?? (String(sp.service_id ?? "").trim() || (servicesAtLocation.length === 1 ? servicesAtLocation[0].id : ""));
  const selectedService = servicesAtLocation.find((service) => service.id === selectedServiceId) ?? null;
  const selectedEmployeeId = rescheduleAppointment?.employee_id ?? String(sp.employee_id ?? "").trim();

  const today = localISODate();
  const lastDate = lastSelfBookableDate(rules, today);
  const defaultDate = rescheduleAppointment ? localISODate(new Date(rescheduleAppointment.starts_at)) : today;
  const requestedDate = String(sp.date ?? defaultDate).trim();
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= today
    ? (requestedDate > lastDate ? lastDate : requestedDate)
    : today;

  const state: BookingState = {
    locationId: rescheduleAppointment ? "" : selectedLocationId,
    serviceId: rescheduleAppointment ? "" : selectedServiceId,
    employeeId: rescheduleAppointment ? "" : selectedEmployeeId,
    date: selectedDate,
    startsAt: String(sp.starts_at ?? "").trim(),
    reschedule: rescheduleAppointment?.id ?? "",
  };
  const href = (patch: Partial<BookingState>) => bookingHref(slug, state, patch);

  const canResolveSlots = Boolean(selectedService && selectedLocation);
  const slotResult = canResolveSlots
    ? await listSelfBookableSlots({
        studioId: studio.id,
        locationId: selectedLocationId,
        serviceId: selectedServiceId,
        dateYmd: selectedDate,
        ignoreAppointmentId: rescheduleAppointment?.id,
        minLeadMinutes: rules.minNoticeMinutes,
        alignToClock: true,
      })
    : null;
  const daySlots = slotResult?.ok ? slotResult.payload.slots : [];
  const staffOnDay = Array.from(new Map(daySlots.map((slot) => [slot.employeeId, slot.employeeName])).entries())
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const selectedEmployeeName = rescheduleAppointment?.employee_name_snapshot
    ?? staffOnDay.find((staff) => staff.id === selectedEmployeeId)?.name
    ?? null;
  const times = groupSlotsByStartTime(
    selectedEmployeeId ? daySlots.filter((slot) => slot.employeeId === selectedEmployeeId) : daySlots,
  );
  const timeGroups = [
    { label: "Morning", times: times.filter((time) => sgtHour(time.startsAtIso) < 12) },
    { label: "Afternoon", times: times.filter((time) => sgtHour(time.startsAtIso) >= 12 && sgtHour(time.startsAtIso) < 17) },
    { label: "Evening", times: times.filter((time) => sgtHour(time.startsAtIso) >= 17) },
  ].filter((group) => group.times.length > 0);
  const selectedTime = state.startsAt ? times.find((time) => time.startsAtIso === state.startsAt) ?? null : null;

  const needsConfirmData = Boolean(selectedTime && selectedService && !isReschedule);
  const [termsVersion, privacyNotice, packageCredits, onlineOptions] = await Promise.all([
    needsConfirmData ? getLatestSalonTermsVersion({ studioId }) : Promise.resolve(null),
    needsConfirmData ? getLatestPrivacyNotice({ studioId }) : Promise.resolve(null),
    needsConfirmData && selfCustomer.ok
      ? listSelfEligiblePackageCredits({ studioId, userId: user.id, locationId: selectedLocationId })
      : Promise.resolve(null),
    needsConfirmData && selectedService
      ? getSelfOnlinePaymentOptions({ studioId, price: selectedService.price })
      : Promise.resolve({ onlineFull: null, onlineDeposit: null }),
  ]);
  const eligiblePackages = packageCredits?.ok ? packageCredits.payload.packages : [];
  const termsSummary = summarizeTermsSnapshot(termsVersion?.content_snapshot ?? null);
  const notice = messageFromStatus(sp.ok, sp.error);

  const stripStart = selectedDate <= shiftLocalIsoDate(today, 6) ? today : selectedDate;
  const stripDays = Array.from({ length: 7 }, (_, index) => shiftLocalIsoDate(stripStart, index))
    .filter((day) => day <= lastDate);
  const nextStripStart = shiftLocalIsoDate(stripStart, 7) <= lastDate ? shiftLocalIsoDate(stripStart, 7) : null;
  const nextDay = shiftLocalIsoDate(selectedDate, 1) <= lastDate ? shiftLocalIsoDate(selectedDate, 1) : null;
  const prevStripStart = stripStart > today
    ? (shiftLocalIsoDate(stripStart, -7) < today ? today : shiftLocalIsoDate(stripStart, -7))
    : null;

  async function bookAppointmentAction(formData: FormData) {
    "use server";
    const actionSupabase = await createClient();
    const {
      data: { user: actionUser },
    } = await actionSupabase.auth.getUser();
    if (!actionUser) {
      redirect(`/${studioSlug}/auth?next=${encodeURIComponent(`/${studioSlug}/appointments`)}`);
    }

    const slotStartsAtIso = String(formData.get("slot_starts_at") ?? "").trim();
    const slotEmployeeId = String(formData.get("slot_employee_id") ?? "").trim();
    const serviceId = String(formData.get("service_id") ?? "").trim();
    const locationId = String(formData.get("location_id") ?? "").trim();
    const date = String(formData.get("date") ?? "").trim();
    const idempotencyKey = String(formData.get("idempotency_key") ?? "").trim() || crypto.randomUUID();
    const accepted = String(formData.get("terms_accepted") ?? "") === "on";
    const termsVersionId = String(formData.get("terms_version_id") ?? "").trim();
    const privacyAccepted = String(formData.get("privacy_accepted") ?? "") === "on";
    const privacyNoticeVersionId = String(formData.get("privacy_notice_version_id") ?? "").trim();
    const paymentOptionRaw = String(formData.get("payment_option") ?? "free").trim();
    const paymentOption = paymentOptionRaw === "package_credit"
      || paymentOptionRaw === "online_deposit"
      || paymentOptionRaw === "online_full"
      ? paymentOptionRaw
      : "free";

    const backState: BookingState = {
      locationId,
      serviceId,
      employeeId: slotEmployeeId,
      date,
      startsAt: slotStartsAtIso,
      reschedule: "",
    };
    const backTo = bookingHref(slug, backState, {});
    const backToTimes = bookingHref(slug, backState, { startsAt: "" });

    if (!slotStartsAtIso || !serviceId || !locationId) {
      redirect(withError(backToTimes, "missing_fields"));
    }
    if (!accepted || !termsVersionId) {
      redirect(withError(backTo, "terms_required"));
    }
    if (!privacyAccepted || !privacyNoticeVersionId) {
      redirect(withError(backTo, "privacy_required"));
    }

    const latestTermsVersion = await getLatestSalonTermsVersion({ studioId });
    if (!latestTermsVersion?.id || latestTermsVersion.id !== termsVersionId) {
      redirect(withError(backTo, "terms_version_stale"));
    }
    const latestPrivacyNotice = await getLatestPrivacyNotice({ studioId });
    if (!latestPrivacyNotice?.id || latestPrivacyNotice.id !== privacyNoticeVersionId) {
      redirect(withError(backTo, "privacy_version_stale"));
    }

    const linkedCustomer = await ensureSelfSalonCustomer({ studioId, userId: actionUser.id });
    if (!linkedCustomer.ok) {
      redirect(withError(backTo, "forbidden"));
    }

    const slot = await resolveSlot({
      studioId,
      locationId,
      serviceId,
      startsAtIso: slotStartsAtIso,
      employeeId: slotEmployeeId,
      minNoticeMinutes: (await getSelfBookingRules({ studioId })).minNoticeMinutes,
    });
    if (!slot) {
      redirect(withError(backToTimes, "slot_conflict"));
    }

    const privacyConsent = await recordSelfPrivacyNoticeConsent({
      userId: actionUser.id,
      studioId,
      customerId: linkedCustomer.salonCustomerId,
      textVersion: latestPrivacyNotice.version_label,
      noticeVersionId: latestPrivacyNotice.id,
    });
    if (!privacyConsent.ok) {
      redirect(withError(backTo, "privacy_consent_failed"));
    }

    const actionResult = await createSelfAppointment({
      userId: actionUser.id,
      studioSlug: studioSlug || studio!.public_slug,
      studioId,
      locationId,
      serviceId,
      employeeId: slot.employeeId,
      startsAtIso: slot.startsAtIso,
      resourceIds: slot.resourceIds,
      termsVersionId,
      settlementOption: paymentOption,
      idempotencyKey,
    });

    if (!actionResult.ok) {
      const lostSlot = actionResult.code === "slot_conflict" || actionResult.code === "resource_conflict";
      redirect(withError(lostSlot ? backToTimes : backTo, actionResult.code));
    }

    revalidatePath(myAppointmentsPath);
    if (actionResult.payload.paymentId) {
      redirect(`/${studioSlug}/checkout/${actionResult.payload.paymentId}`);
    }
    redirect(`${myAppointmentsPath}?ok=booked`);
  }

  async function rescheduleAppointmentAction(formData: FormData) {
    "use server";
    const actionSupabase = await createClient();
    const {
      data: { user: actionUser },
    } = await actionSupabase.auth.getUser();
    if (!actionUser) {
      redirect(`/${studioSlug}/auth?next=${encodeURIComponent(myAppointmentsPath)}`);
    }

    const appointmentId = String(formData.get("appointment_id") ?? "").trim();
    const slotStartsAtIso = String(formData.get("slot_starts_at") ?? "").trim();
    const backToTimes = bookingHref(slug, {
      locationId: "",
      serviceId: "",
      employeeId: "",
      date: slotStartsAtIso ? localISODate(new Date(slotStartsAtIso)) : "",
      startsAt: "",
      reschedule: appointmentId,
    }, {});

    const owned = await listSelfAppointments({ studioId, userId: actionUser.id });
    const appointment = owned.ok ? owned.payload.appointments.find((row) => row.id === appointmentId) : null;
    if (!appointment) {
      redirect(`${myAppointmentsPath}?error=not_found`);
    }

    const slot = await resolveSlot({
      studioId,
      locationId: appointment.location_id,
      serviceId: appointment.service_id,
      startsAtIso: slotStartsAtIso,
      employeeId: appointment.employee_id,
      minNoticeMinutes: (await getSelfBookingRules({ studioId })).minNoticeMinutes,
      ignoreAppointmentId: appointment.id,
    });
    if (!slot) {
      redirect(withError(backToTimes, "slot_conflict"));
    }

    const operation = await rescheduleSelfAppointment({
      userId: actionUser.id,
      studioId,
      appointmentId,
      newStartsAtIso: slot.startsAtIso,
      newResourceIds: slot.resourceIds,
      reason: "customer_rescheduled",
      idempotencyKey: `apt04-reschedule:${appointmentId}:${slot.startsAtIso}`,
    });
    if (!operation.ok) {
      redirect(withError(backToTimes, operation.code));
    }

    revalidatePath(myAppointmentsPath);
    redirect(`${myAppointmentsPath}?ok=rescheduled`);
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className={ui.h1}>{isReschedule ? "Change appointment time" : "Book appointment"}</h1>
          <p className={`mt-1 ${ui.muted}`}>
            {isReschedule && rescheduleAppointment
              ? `${rescheduleAppointment.service_title_snapshot} with ${rescheduleAppointment.employee_name_snapshot} · currently ${formatLocalDate(rescheduleAppointment.starts_at, { weekday: "short", month: "short", day: "numeric" })} ${formatLocalTime(rescheduleAppointment.starts_at)}`
              : `Choose a service and a time at ${studio.name}. Times are in Singapore time.`}
          </p>
        </div>

        {notice ? (
          <div
            role={notice.tone === "ok" ? "status" : "alert"}
            className={`${ui.card} ${notice.tone === "ok" ? "border-teal-300" : "border-rose-300"}`}
          >
            <p className={notice.tone === "ok" ? "text-teal-700 dark:text-teal-300" : "text-rose-700 dark:text-rose-300"}>{notice.text}</p>
          </div>
        ) : null}

        {!selfCustomer.ok ? (
          <section className={ui.card}>
            <p className={ui.muted}>Your login is not yet linked to a salon customer profile in this studio. Please contact front desk.</p>
          </section>
        ) : (
          <>
            {!isReschedule ? (
              <section className={`${ui.card} space-y-4`} aria-labelledby="booking-service-heading">
                <div className="flex items-start gap-3">
                  <span className={stepBadge}>1</span>
                  <div>
                    <h2 id="booking-service-heading" className={ui.h3}>Choose a service</h2>
                    {catalog.locations.length > 1 ? (
                      <p className={`mt-0.5 ${ui.muted}`}>Pick a location first.</p>
                    ) : null}
                  </div>
                </div>

                {catalog.locations.length > 1 ? (
                  <nav aria-label="Location" className="flex flex-wrap gap-2">
                    {catalog.locations.map((location) => (
                      <Link
                        key={location.id}
                        href={href({ locationId: location.id, serviceId: "", employeeId: "", startsAt: "" })}
                        className={location.id === selectedLocationId ? chipActive : chipIdle}
                        aria-current={location.id === selectedLocationId ? "true" : undefined}
                      >
                        {location.name}
                      </Link>
                    ))}
                  </nav>
                ) : null}

                {selectedLocation ? (
                  servicesAtLocation.length ? (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {servicesAtLocation.map((service) => {
                        const active = service.id === selectedServiceId;
                        return (
                          <li key={service.id}>
                            <Link
                              href={href({ serviceId: service.id, employeeId: "", startsAt: "" })}
                              aria-current={active ? "true" : undefined}
                              className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition ${
                                active
                                  ? "border-teal-500 bg-teal-50 dark:border-teal-600 dark:bg-teal-950/40"
                                  : "border-stone-200 bg-white hover:border-teal-300 dark:border-stone-700 dark:bg-stone-950"
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block font-medium text-stone-900 dark:text-stone-100">{service.name}</span>
                                <span className={`block text-xs ${ui.muted}`}>{service.defaultDurationMinutes} min</span>
                              </span>
                              {service.price > 0 ? (
                                <span className="shrink-0 text-sm font-semibold text-stone-800 dark:text-stone-100">
                                  {formatMoney(service.price, service.currency)}
                                </span>
                              ) : null}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className={ui.muted}>No services can be booked online at this location yet.</p>
                  )
                ) : null}
              </section>
            ) : null}

            <section className={`${ui.card} space-y-4`} aria-labelledby="booking-time-heading">
              <div className="flex items-start gap-3">
                <span className={stepBadge}>{isReschedule ? 1 : 2}</span>
                <div className="min-w-0 flex-1">
                  <h2 id="booking-time-heading" className={ui.h3}>Choose a time</h2>
                  <p className={`mt-0.5 ${ui.muted}`}>
                    {selectedService && selectedLocation
                      ? `${selectedService.name} · ${selectedService.defaultDurationMinutes} min · ${selectedLocation.name}`
                      : isReschedule
                        ? "This service is no longer bookable online. Please contact the studio to change your time."
                        : "Choose a service to see available times."}
                  </p>
                </div>
              </div>

              {canResolveSlots ? (
                <>
                  <nav aria-label="Date" className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {prevStripStart ? (
                      <Link href={href({ date: prevStripStart, startsAt: "" })} className={ui.btnGhost} aria-label="Previous week">
                        <span aria-hidden="true">←</span>
                      </Link>
                    ) : null}
                    {stripDays.map((day) => {
                      const active = day === selectedDate;
                      const noon = `${day}T12:00:00+08:00`;
                      return (
                        <Link
                          key={day}
                          href={href({ date: day, startsAt: "" })}
                          aria-current={active ? "date" : undefined}
                          className={`flex min-w-12 shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 text-xs transition ${
                            active
                              ? "border-teal-600 bg-teal-600 text-white"
                              : "border-stone-200 bg-white text-stone-700 hover:border-teal-400 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200"
                          }`}
                        >
                          <span>{day === today ? "Today" : formatLocalDate(noon, { weekday: "short" })}</span>
                          <span className="text-base font-semibold">{formatLocalDate(noon, { day: "numeric" })}</span>
                        </Link>
                      );
                    })}
                    {nextStripStart ? (
                      <Link href={href({ date: nextStripStart, startsAt: "" })} className={ui.btnGhost} aria-label="Next week">
                        <span aria-hidden="true">→</span>
                      </Link>
                    ) : null}
                  </nav>

                  {!isReschedule && (staffOnDay.length > 1 || selectedEmployeeId) ? (
                    <nav aria-label="Staff" className="flex flex-wrap items-center gap-2">
                      <span className={`${ui.label} mr-1`}>Staff</span>
                      <Link
                        href={href({ employeeId: "", startsAt: "" })}
                        className={!selectedEmployeeId ? chipActive : chipIdle}
                      >
                        Any available
                      </Link>
                      {staffOnDay.map((staff) => (
                        <Link
                          key={staff.id}
                          href={href({ employeeId: staff.id, startsAt: "" })}
                          className={staff.id === selectedEmployeeId ? chipActive : chipIdle}
                        >
                          {staff.name}
                        </Link>
                      ))}
                    </nav>
                  ) : null}

                  {!slotResult?.ok ? (
                    <p className="text-sm text-rose-700 dark:text-rose-300">{slotResult?.message ?? "Could not load times."}</p>
                  ) : times.length === 0 ? (
                    <div className={`${ui.emptyState} px-4`}>
                      <p className="text-sm font-medium text-stone-800 dark:text-stone-100">
                        {selectedEmployeeId && !isReschedule && staffOnDay.length > 0
                          ? "Your chosen staff member has no times on this date"
                          : "No times available on this date"}
                      </p>
                      <p className={ui.muted}>
                        {selectedEmployeeId && !isReschedule && staffOnDay.length > 0
                          ? "Choose “Any available” or try another day."
                          : "Try another day to see more availability."}
                      </p>
                      {nextDay ? (
                        <Link href={href({ date: nextDay, startsAt: "" })} className={ui.btnSecondarySm}>
                          Check next day <span aria-hidden="true">→</span>
                        </Link>
                      ) : (
                        <p className={`text-xs ${ui.muted}`}>Online booking opens up to {rules.maxAdvanceDays} days ahead.</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {state.startsAt && !selectedTime ? (
                        <p className="text-sm text-rose-700 dark:text-rose-300">That time is no longer available. Please choose another.</p>
                      ) : null}
                      {timeGroups.map((group) => (
                        <div key={group.label}>
                          <p className={`mb-1.5 text-xs font-medium uppercase tracking-wide ${ui.muted}`}>{group.label}</p>
                          <ul className="flex flex-wrap gap-2">
                            {group.times.map((time) => {
                              const active = time.startsAtIso === selectedTime?.startsAtIso;
                              return (
                                <li key={time.startsAtIso}>
                                  <Link
                                    href={`${href({ startsAt: time.startsAtIso })}#booking-confirm`}
                                    aria-current={active ? "true" : undefined}
                                    className={`${active ? chipActive : chipIdle} min-w-18 tabular-nums`}
                                  >
                                    {formatLocalTime(time.startsAtIso)}
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </section>

            {selectedTime && selectedService && selectedLocation ? (
              <section id="booking-confirm" className={`${ui.card} space-y-4 border-teal-300 dark:border-teal-800`} aria-labelledby="booking-confirm-heading">
                <div className="flex items-start gap-3">
                  <span className={stepBadge}>{isReschedule ? 2 : 3}</span>
                  <h2 id="booking-confirm-heading" className={ui.h3}>{isReschedule ? "Confirm new time" : "Confirm booking"}</h2>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className={ui.muted}>Service</dt>
                  <dd className="text-stone-900 dark:text-stone-100">{selectedService.name} · {selectedService.defaultDurationMinutes} min</dd>
                  {isReschedule && rescheduleAppointment ? (
                    <>
                      <dt className={ui.muted}>Current</dt>
                      <dd className="text-stone-500 line-through dark:text-stone-400">
                        {formatLocalDate(rescheduleAppointment.starts_at, { weekday: "short", month: "short", day: "numeric" })} · {formatLocalTime(rescheduleAppointment.starts_at)}
                      </dd>
                    </>
                  ) : null}
                  <dt className={ui.muted}>{isReschedule ? "New time" : "When"}</dt>
                  <dd className="font-medium text-stone-900 dark:text-stone-100">
                    {formatLocalDate(selectedTime.startsAtIso, { weekday: "short", month: "short", day: "numeric" })} · {formatLocalTime(selectedTime.startsAtIso)}–{formatLocalTime(selectedTime.endsAtIso)}
                  </dd>
                  <dt className={ui.muted}>Staff</dt>
                  <dd className="text-stone-900 dark:text-stone-100">{selectedEmployeeName ?? "Any available staff"}</dd>
                  <dt className={ui.muted}>Location</dt>
                  <dd className="text-stone-900 dark:text-stone-100">{selectedLocation.name}</dd>
                  {!isReschedule && selectedService.price > 0 ? (
                    <>
                      <dt className={ui.muted}>Price</dt>
                      <dd className="text-stone-900 dark:text-stone-100">{formatMoney(selectedService.price, selectedService.currency)}</dd>
                    </>
                  ) : null}
                </dl>

                {isReschedule && rescheduleAppointment ? (
                  <form action={rescheduleAppointmentAction} className="grid gap-2">
                    <input type="hidden" name="appointment_id" value={rescheduleAppointment.id} />
                    <input type="hidden" name="slot_starts_at" value={selectedTime.startsAtIso} />
                    <button type="submit" className={ui.btnPrimary}>Confirm new time</button>
                    <Link href={myAppointmentsPath} className={`${ui.btnGhost} justify-center`}>Keep current time</Link>
                  </form>
                ) : !termsVersion?.id ? (
                  <p className="text-sm text-rose-700 dark:text-rose-300">Terms & Conditions version is missing. Please contact front desk.</p>
                ) : !privacyNotice?.id ? (
                  <p className="text-sm text-rose-700 dark:text-rose-300">Privacy notice version is missing. Please contact front desk.</p>
                ) : (
                  <form action={bookAppointmentAction} className="grid gap-4">
                    <input type="hidden" name="slot_starts_at" value={selectedTime.startsAtIso} />
                    <input type="hidden" name="slot_employee_id" value={selectedEmployeeId} />
                    <input type="hidden" name="service_id" value={selectedServiceId} />
                    <input type="hidden" name="location_id" value={selectedLocationId} />
                    <input type="hidden" name="date" value={selectedDate} />
                    <input
                      type="hidden"
                      name="idempotency_key"
                      value={`apt04-self-create:${crypto.randomUUID()}`}
                    />
                    <input type="hidden" name="terms_version_id" value={termsVersion.id} />
                    <input type="hidden" name="privacy_notice_version_id" value={privacyNotice.id} />

                    <fieldset className="grid gap-2">
                      <legend className={`${ui.label} mb-1.5`}>Payment</legend>
                      {eligiblePackages.length ? (
                        <label className="flex items-start gap-2 rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-700">
                          <input type="radio" name="payment_option" value="package_credit" defaultChecked className="mt-0.5" />
                          <span>
                            <span className="block font-medium text-stone-900 dark:text-stone-100">Use package credits</span>
                            <span className={`block text-xs ${ui.muted}`}>
                              {eligiblePackages.map((pkg) => `${pkg.packageName} (${pkg.creditsLeft} left)`).join(", ")}
                            </span>
                          </span>
                        </label>
                      ) : null}
                      <label className="flex items-start gap-2 rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-700">
                        <input type="radio" name="payment_option" value="free" defaultChecked={!eligiblePackages.length} className="mt-0.5" />
                        <span className="font-medium text-stone-900 dark:text-stone-100">Pay at the studio</span>
                      </label>
                      {onlineOptions.onlineFull != null ? (
                        <label className="flex items-start gap-2 rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-700">
                          <input type="radio" name="payment_option" value="online_full" className="mt-0.5" />
                          <span className="font-medium text-stone-900 dark:text-stone-100">
                            Online full payment · {formatMoney(onlineOptions.onlineFull, selectedService.currency)}
                          </span>
                        </label>
                      ) : null}
                      {onlineOptions.onlineDeposit != null ? (
                        <label className="flex items-start gap-2 rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-700">
                          <input type="radio" name="payment_option" value="online_deposit" className="mt-0.5" />
                          <span className="font-medium text-stone-900 dark:text-stone-100">
                            Online deposit (30%) · {formatMoney(onlineOptions.onlineDeposit, selectedService.currency)}
                          </span>
                        </label>
                      ) : null}
                      {!eligiblePackages.length ? (
                        <p className={`text-xs ${ui.muted}`} data-eligibility-policy="conservative">
                          Package credits require an active, unexpired package valid at this location.
                        </p>
                      ) : null}
                    </fieldset>

                    <details className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-900/40">
                      <summary className="cursor-pointer text-sm font-medium text-stone-700 dark:text-stone-200">
                        Terms & Conditions {termsVersion.version_label ? `(${termsVersion.version_label})` : ""}
                      </summary>
                      {termsSummary ? (
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-stone-700 dark:text-stone-300">
                          {termsSummary}
                        </pre>
                      ) : (
                        <p className={`mt-2 text-xs ${ui.muted}`}>No content snapshot is available for this version.</p>
                      )}
                    </details>

                    <div className="grid gap-2">
                      <label className="inline-flex items-start gap-2 text-xs leading-relaxed text-stone-600 dark:text-stone-300">
                        <input type="checkbox" name="terms_accepted" required className="mt-0.5" />
                        <span>
                          I accept Terms & Conditions {termsVersion.version_label ? `(${termsVersion.version_label})` : ""}.
                        </span>
                      </label>
                      <label className="inline-flex items-start gap-2 text-xs leading-relaxed text-stone-600 dark:text-stone-300">
                        <input type="checkbox" name="privacy_accepted" required className="mt-0.5" />
                        <span>
                          {studio.name} may use my name, contact details, and appointment details to book and run this visit.
                        </span>
                      </label>
                    </div>

                    <button type="submit" className={ui.btnPrimary}>Book appointment</button>
                    <p className={`text-center text-xs ${ui.muted}`}>Availability is checked again when you book.</p>
                  </form>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
