import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import Link from "next/link";
import { formatLocalDate, formatLocalTime, localISODate, shiftLocalIsoDate } from "@/lib/date";
import {
  createSelfAppointment,
  ensureSelfSalonCustomer,
  getLatestSalonTermsVersion,
  listSelfBookableCatalog,
  listSelfBookableSlots,
  listSelfEligiblePackageCredits,
  summarizeTermsSnapshot,
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
    date?: string;
    error?: string;
    ok?: string;
  }>;
};

function messageFromStatus(ok: string | undefined, error: string | undefined) {
  if (ok === "booked") {
    return { tone: "ok" as const, text: "Appointment request submitted successfully." };
  }
  if (!error) return null;
  const map: Record<string, string> = {
    missing_fields: "Please select location, service and slot.",
    terms_required: "Please accept the Terms & Conditions before booking.",
    terms_version_stale: "Terms & Conditions have been updated. Please review the latest version and submit again.",
    privacy_required: "Please accept the privacy notice before booking.",
    privacy_version_stale: "The privacy notice has been updated. Please review the latest version and submit again.",
    privacy_consent_failed: "Could not record privacy notice consent. Please try again.",
    invalid_slot: "The selected slot is invalid.",
    forbidden: "Your account is not linked to this studio customer profile.",
    slot_conflict: "This slot was just taken. Please choose another one.",
    resource_conflict: "Required room/resource is unavailable for this slot.",
    invalid_request: "Request is invalid. Please refresh and retry.",
    idempotency_in_progress: "A similar request is processing. Try again shortly.",
    idempotency_conflict: "Duplicate request mismatch detected. Please retry.",
    insufficient_credits: "No eligible package credits are available for this location.",
    package_not_eligible: "Package credits are not eligible for this appointment.",
    payment_create_failed: "Could not create online payment request. Please try again.",
    payment_config_missing: "Studio online payment is not configured.",
  };
  return { tone: "error" as const, text: map[error] ?? `Booking failed (${error}).` };
}

export default async function StudioAppointmentsBookingPage({ params, searchParams }: Props) {
  const { studioSlug: rawStudioSlug } = await params;
  const sp = await searchParams;
  const studioSlug = normalizeStudioSlug(rawStudioSlug);

  if (!studioSlug) redirect("/");

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
  const catalog = await listSelfBookableCatalog({ studioId: studio.id });
  const selectedLocationId = String(sp.location_id ?? "").trim() || (catalog.locations.length === 1 ? catalog.locations[0].id : "");
  const selectedServiceId = String(sp.service_id ?? "").trim() || (catalog.services.length === 1 ? catalog.services[0].id : "");
  const today = localISODate();
  const requestedDate = String(sp.date ?? today).trim();
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= today ? requestedDate : today;

  const selectedService = catalog.services.find((service) => service.id === selectedServiceId) ?? null;
  const selectedLocation = catalog.locations.find((location) => location.id === selectedLocationId) ?? null;
  const canResolveSlots = Boolean(selectedService && selectedLocation && selectedService.locationIds.includes(selectedLocation.id));
  const slotResult = canResolveSlots
    ? await listSelfBookableSlots({
        studioId: studio.id,
        locationId: selectedLocationId,
        serviceId: selectedServiceId,
        dateYmd: selectedDate,
      })
    : null;

  const termsVersion = await getLatestSalonTermsVersion({ studioId: studio.id });
  const privacyNotice = await getLatestPrivacyNotice({ studioId: studio.id });
  const packageCredits =
    selfCustomer.ok && selectedLocationId
      ? await listSelfEligiblePackageCredits({
          studioId,
          userId: user.id,
          locationId: selectedLocationId,
        })
      : null;
  const notice = messageFromStatus(sp.ok, sp.error);
  const availableSlots = slotResult?.ok ? slotResult.payload.slots : [];
  const termsSummary = summarizeTermsSnapshot(termsVersion?.content_snapshot ?? null);
  const defaultPayment = packageCredits?.ok && packageCredits.payload.packages.length > 0 ? "package_credit" : "free";
  const bookingQuery = (date: string) => {
    const query = new URLSearchParams();
    if (selectedLocationId) query.set("location_id", selectedLocationId);
    if (selectedServiceId) query.set("service_id", selectedServiceId);
    query.set("date", date);
    return `/${studioSlug}/appointments?${query.toString()}`;
  };

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
    const resourceIdsRaw = String(formData.get("resource_ids") ?? "").trim();
    const resourceIds = resourceIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const query = new URLSearchParams();
    if (serviceId) query.set("service_id", serviceId);
    if (locationId) query.set("location_id", locationId);
    if (date) query.set("date", date);
    const backTo = `/${studioSlug}/appointments${query.toString() ? `?${query.toString()}` : ""}`;

    if (!slotStartsAtIso || !slotEmployeeId || !serviceId || !locationId) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=missing_fields`);
    }
    if (!accepted || !termsVersionId) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=terms_required`);
    }
    if (!privacyAccepted || !privacyNoticeVersionId) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=privacy_required`);
    }

    const latestTermsVersion = await getLatestSalonTermsVersion({ studioId });
    if (!latestTermsVersion?.id || latestTermsVersion.id !== termsVersionId) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=terms_version_stale`);
    }
    const latestPrivacyNotice = await getLatestPrivacyNotice({ studioId });
    if (!latestPrivacyNotice?.id || latestPrivacyNotice.id !== privacyNoticeVersionId) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=privacy_version_stale`);
    }

    const linkedCustomer = await ensureSelfSalonCustomer({ studioId, userId: actionUser.id });
    if (!linkedCustomer.ok) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=forbidden`);
    }
    const privacyConsent = await recordSelfPrivacyNoticeConsent({
      userId: actionUser.id,
      studioId,
      customerId: linkedCustomer.salonCustomerId,
      textVersion: latestPrivacyNotice.version_label,
      noticeVersionId: latestPrivacyNotice.id,
    });
    if (!privacyConsent.ok) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=privacy_consent_failed`);
    }

    const actionResult = await createSelfAppointment({
      userId: actionUser.id,
      studioSlug: studioSlug || studio!.public_slug,
      studioId,
      locationId,
      serviceId,
      employeeId: slotEmployeeId,
      startsAtIso: slotStartsAtIso,
      resourceIds,
      termsVersionId,
      settlementOption: paymentOption,
      idempotencyKey,
    });

    if (!actionResult.ok) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=${encodeURIComponent(actionResult.code)}`);
    }

    revalidatePath(`/${studioSlug}/me/appointments`);
    if (actionResult.payload.paymentId) {
      redirect(`/${studioSlug}/checkout/${actionResult.payload.paymentId}`);
    }
    redirect(`/${studioSlug}/me/appointments?ok=booked`);
  }

  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className={ui.h1}>Book appointment</h1>
          <p className={`mt-1 ${ui.muted}`}>Choose a service, location, and real-time slot at {studio.name}.</p>
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
            <form method="get" className={`${ui.card} grid gap-4 sm:grid-cols-2`} aria-labelledby="booking-search-heading">
              <input type="hidden" name="_" value="slots" />
              <div className="flex items-start gap-3 sm:col-span-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">1</span>
                <div>
                  <h2 id="booking-search-heading" className={ui.h3}>Choose your appointment</h2>
                  <p className={`mt-0.5 ${ui.muted}`}>Select a location, service, and preferred date.</p>
                </div>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="booking-location" className={`${ui.label} mb-1.5 block`}>Location</label>
                <select id="booking-location" name="location_id" className={ui.input} defaultValue={selectedLocationId} required>
                  <option value="">Select location</option>
                  {catalog.locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="booking-service" className={`${ui.label} mb-1.5 block`}>Service</label>
                <select id="booking-service" name="service_id" className={ui.input} defaultValue={selectedServiceId} required>
                  <option value="">Select service</option>
                  {catalog.services.map((service) => (
                    <option key={service.id} value={service.id}>{service.name}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="booking-date" className={`${ui.label} mb-1.5 block`}>Date (SGT)</label>
                <div className="flex min-w-0 items-center gap-1">
                  {selectedDate > today ? (
                    <Link
                      href={bookingQuery(shiftLocalIsoDate(selectedDate, -1))}
                      className={ui.btnGhost}
                      aria-label="Previous day"
                    >
                      <span aria-hidden="true">←</span>
                      <span className="sr-only sm:not-sr-only">Prev</span>
                    </Link>
                  ) : (
                    <span className={`${ui.btnGhost} cursor-not-allowed opacity-40`} aria-disabled="true">
                      <span aria-hidden="true">←</span>
                      <span className="sr-only sm:not-sr-only">Prev</span>
                    </span>
                  )}
                  <input
                    id="booking-date"
                    type="date"
                    name="date"
                    className={`${ui.input} min-w-0 flex-1`}
                    defaultValue={selectedDate}
                    min={today}
                    required
                  />
                  <Link
                    href={bookingQuery(shiftLocalIsoDate(selectedDate, 1))}
                    className={ui.btnGhost}
                    aria-label="Next day"
                  >
                    <span className="sr-only sm:not-sr-only">Next</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>

              <div className="sm:col-span-1 flex items-end">
                <button type="submit" className={`${ui.btnPrimary} w-full`}>Show available times</button>
              </div>
            </form>

            <section className={ui.card}>
              <div className="flex items-start gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">2</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className={ui.h3}>Available slots</h2>
                    {canResolveSlots && slotResult?.ok ? (
                      <span className={ui.badgeNeutral}>{availableSlots.length} available</span>
                    ) : null}
                  </div>
                  <p className={`mt-0.5 text-sm ${ui.muted}`}>
                    {selectedService && selectedLocation
                      ? `${selectedService.name} · ${selectedService.defaultDurationMinutes} min · ${selectedLocation.name}`
                      : "Available times will appear after you complete step 1."}
                  </p>
                </div>
              </div>

              {termsVersion?.id ? (
                <details className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-900/40">
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
              ) : null}

              {!canResolveSlots ? (
                <p className={`mt-4 text-sm ${ui.muted}`}>
                  {selectedService && selectedLocation
                    ? "This service is not offered at the selected location. Choose another service or location."
                    : "Complete step 1 to see available times."}
                </p>
              ) : !slotResult?.ok ? (
                <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">{slotResult?.message ?? "Could not load slots."}</p>
              ) : availableSlots.length === 0 ? (
                <div className={`${ui.emptyState} mt-4 px-4`}>
                  <p className="text-sm font-medium text-stone-800 dark:text-stone-100">No times available on this date</p>
                  <p className={ui.muted}>Try another day to see more availability.</p>
                  <Link href={bookingQuery(shiftLocalIsoDate(selectedDate, 1))} className={ui.btnSecondarySm}>
                    Check next day <span aria-hidden="true">→</span>
                  </Link>
                </div>
              ) : !termsVersion?.id ? (
                <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">Terms & Conditions version is missing. Please contact front desk.</p>
              ) : !privacyNotice?.id ? (
                <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">Privacy notice version is missing. Please contact front desk.</p>
              ) : (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {availableSlots.map((slot, index) => (
                    <li key={`${slot.startsAtIso}:${slot.employeeId}`}>
                      <details
                        open={index === 0}
                        className="group rounded-xl border border-stone-200 bg-white open:border-teal-300 open:shadow-sm dark:border-stone-700 dark:bg-stone-950 dark:open:border-teal-700"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-3 [&::-webkit-details-marker]:hidden">
                          <span>
                            <span className="block font-semibold text-stone-900 dark:text-stone-100">
                              {formatLocalTime(slot.startsAtIso)}
                            </span>
                            <span className={`block text-xs ${ui.muted}`}>
                              {slot.employeeName} · {formatLocalDate(slot.startsAtIso, { weekday: "short", month: "short", day: "2-digit" })}
                            </span>
                          </span>
                          <span className="text-sm font-medium text-teal-700 group-open:hidden dark:text-teal-300">Choose</span>
                          <span className="hidden text-sm font-medium text-teal-700 group-open:inline dark:text-teal-300">Close</span>
                        </summary>

                        <form action={bookAppointmentAction} className="grid gap-3 border-t border-stone-100 p-3 dark:border-stone-800">
                          <input type="hidden" name="slot_starts_at" value={slot.startsAtIso} />
                          <input type="hidden" name="slot_employee_id" value={slot.employeeId} />
                          <input type="hidden" name="resource_ids" value={slot.resourceIds.join(",")} />
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

                          <label>
                            <span className={`${ui.label} mb-1.5 block`}>Payment</span>
                            <select name="payment_option" className={ui.select} defaultValue={defaultPayment} required>
                              <option value="free">Pay at appointment</option>
                              <option value="package_credit" disabled={!packageCredits?.ok || !packageCredits.payload.packages.length}>
                                Use package credits {!packageCredits?.ok || !packageCredits.payload.packages.length ? "(not eligible)" : ""}
                              </option>
                              <option value="online_deposit">Online deposit (30%)</option>
                              <option value="online_full">Online full payment</option>
                            </select>
                          </label>
                          {packageCredits?.ok && packageCredits.payload.packages.length ? (
                            <p className={`text-xs ${ui.muted}`}>
                              Eligible package credits: {packageCredits.payload.packages.map((pkg) => `${pkg.packageName} (${pkg.creditsLeft})`).join(", ")}
                            </p>
                          ) : (
                            <p className={`text-xs ${ui.muted}`} data-eligibility-policy="conservative">
                              Package credits require an active, unexpired package valid at this location.
                            </p>
                          )}
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
                          <button type="submit" className={ui.btnPrimarySm}>Book this slot</button>
                          <p className={`text-center text-xs ${ui.muted}`}>Availability is checked again when you book.</p>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
