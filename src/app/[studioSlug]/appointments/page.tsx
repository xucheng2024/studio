import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mergeGuestRecordsForUser } from "@/lib/guestMerge";
import { formatLocalDate, formatLocalTime, localISODate } from "@/lib/date";
import {
  createSelfAppointment,
  getLatestSalonTermsVersion,
  listSelfBookableCatalog,
  listSelfBookableSlots,
  listSelfEligiblePackageCredits,
  resolveSelfSalonCustomer,
} from "@/lib/salon-appointments-self";
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

function summarizeTermsSnapshot(snapshot: unknown) {
  if (typeof snapshot === "string") return snapshot.trim();
  if (!snapshot || typeof snapshot !== "object") return "";
  const row = snapshot as Record<string, unknown>;
  const textCandidate = [
    row.content,
    row.text,
    row.body,
    row.summary,
    row.markdown,
    row.html,
  ].find((value) => typeof value === "string" && String(value).trim().length > 0);
  if (typeof textCandidate === "string") return textCandidate.trim();
  try {
    return JSON.stringify(snapshot, null, 2);
  } catch {
    return "";
  }
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

  const selfCustomer = await resolveSelfSalonCustomer({ studioId: studio.id, userId: user.id });
  const studioId = studio.id;
  const catalog = await listSelfBookableCatalog({ studioId: studio.id });
  const selectedLocationId = String(sp.location_id ?? "").trim();
  const selectedServiceId = String(sp.service_id ?? "").trim();
  const selectedDate = String(sp.date ?? localISODate()).trim();

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

    const latestTermsVersion = await getLatestSalonTermsVersion({ studioId });
    if (!latestTermsVersion?.id || latestTermsVersion.id !== termsVersionId) {
      redirect(`${backTo}${query.toString() ? "&" : "?"}error=terms_version_stale`);
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
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className={ui.h1}>Book appointment</h1>
          <p className={`mt-1 ${ui.muted}`}>Choose a service, location, and real-time slot at {studio.name}.</p>
        </div>

        {notice ? (
          <div className={`${ui.card} ${notice.tone === "ok" ? "border-teal-300" : "border-rose-300"}`}>
            <p className={notice.tone === "ok" ? "text-teal-700 dark:text-teal-300" : "text-rose-700 dark:text-rose-300"}>{notice.text}</p>
          </div>
        ) : null}

        {!selfCustomer.ok ? (
          <section className={ui.card}>
            <p className={ui.muted}>Your login is not yet linked to a salon customer profile in this studio. Please contact front desk.</p>
          </section>
        ) : (
          <>
            <form method="get" className={`${ui.card} grid gap-3 sm:grid-cols-4`}>
              <input type="hidden" name="_" value="slots" />
              <div className="sm:col-span-1">
                <label className={ui.label}>Location</label>
                <select name="location_id" className={ui.input} defaultValue={selectedLocationId} required>
                  <option value="">Select location</option>
                  {catalog.locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label className={ui.label}>Service</label>
                <select name="service_id" className={ui.input} defaultValue={selectedServiceId} required>
                  <option value="">Select service</option>
                  {catalog.services.map((service) => (
                    <option key={service.id} value={service.id}>{service.name}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-1">
                <label className={ui.label}>Date (SGT)</label>
                <input type="date" name="date" className={ui.input} defaultValue={selectedDate} required />
              </div>

              <div className="sm:col-span-1 flex items-end">
                <button type="submit" className={`${ui.btnPrimary} w-full`}>Find slots</button>
              </div>
            </form>

            <section className={ui.card}>
              <h2 className={ui.h3}>Available slots</h2>
              <p className={`mt-1 text-sm ${ui.muted}`}>Real-time availability is checked again during submit to prevent concurrency conflicts.</p>

              {termsVersion?.id ? (
                <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900/40">
                  <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                    Terms & Conditions {termsVersion.version_label ? `(${termsVersion.version_label})` : ""}
                  </p>
                  {termsSummary ? (
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-stone-700 dark:text-stone-300">
                      {termsSummary}
                    </pre>
                  ) : (
                    <p className={`mt-2 text-xs ${ui.muted}`}>No content snapshot is available for this version.</p>
                  )}
                </div>
              ) : null}

              {!canResolveSlots ? (
                <p className={`mt-4 text-sm ${ui.muted}`}>Select a valid location and service to load slots.</p>
              ) : !slotResult?.ok ? (
                <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">{slotResult?.message ?? "Could not load slots."}</p>
              ) : availableSlots.length === 0 ? (
                <p className={`mt-4 text-sm ${ui.muted}`}>No available slots on {selectedDate}. Try another date.</p>
              ) : !termsVersion?.id ? (
                <p className="mt-4 text-sm text-rose-700 dark:text-rose-300">Terms & Conditions version is missing. Please contact front desk.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {availableSlots.map((slot) => (
                    <li key={`${slot.startsAtIso}:${slot.employeeId}`} className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-stone-900 dark:text-stone-100">
                            {formatLocalDate(slot.startsAtIso, { weekday: "short", month: "short", day: "2-digit" })} · {formatLocalTime(slot.startsAtIso)}
                          </p>
                          <p className={`text-sm ${ui.muted}`}>Staff: {slot.employeeName}</p>
                        </div>
                        <form action={bookAppointmentAction} className="grid gap-2 sm:grid-cols-2">
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

                          <label className="sm:col-span-2 text-xs font-medium text-stone-700 dark:text-stone-200">
                            Payment option
                          </label>
                          <select name="payment_option" className={`${ui.input} sm:col-span-2`} defaultValue="free" required>
                            <option value="free">No prepayment (Phase 1 compatible)</option>
                            <option value="package_credit" disabled={!packageCredits?.ok || !packageCredits.payload.packages.length}>
                              Use package credits {!packageCredits?.ok || !packageCredits.payload.packages.length ? "(not eligible)" : ""}
                            </option>
                            <option value="online_deposit">Online deposit (30%)</option>
                            <option value="online_full">Online full payment</option>
                          </select>

                          {packageCredits?.ok && packageCredits.payload.packages.length ? (
                            <p className={`sm:col-span-2 text-xs ${ui.muted}`}>
                              Eligible package credits: {packageCredits.payload.packages.map((pkg) => `${pkg.packageName} (${pkg.creditsLeft})`).join(", ")}
                            </p>
                          ) : (
                            <p className={`sm:col-span-2 text-xs ${ui.muted}`}>
                              Package rule (conservative): same studio + location scope + active package + unexpired + credits &gt; 0.
                            </p>
                          )}

                          <label className="sm:col-span-2 inline-flex items-start gap-2 text-xs text-stone-600 dark:text-stone-300">
                            <input type="checkbox" name="terms_accepted" required className="mt-0.5" />
                            <span>
                              I accept Terms & Conditions {termsVersion.version_label ? `(${termsVersion.version_label})` : ""}.
                            </span>
                          </label>
                          <button type="submit" className={`${ui.btnPrimarySm} sm:col-span-2`}>Book this slot</button>
                        </form>
                      </div>
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
