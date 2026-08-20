"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listStaffBookableSlotsAction, type StaffBookableSlot } from "@/app/(app)/dashboard/actions";
import { shiftLocalIsoDate } from "@/lib/date";
import { ui } from "@/lib/ui";

type Props = {
  studioId: string;
  defaultDate: string;
  defaultStartsAt?: string;
  locationField?: string;
  serviceField?: string;
  employeeField?: string;
  startsAtName?: string;
  resourceIdsName?: string;
  ignoreAppointmentId?: string;
};

function fieldValue(form: HTMLFormElement | null, name: string) {
  if (!form) return "";
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
    return field.value.trim();
  }
  return "";
}

function setFieldValue(form: HTMLFormElement | null, name: string, value: string) {
  if (!form) return;
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function AppointmentSlotPicker({
  studioId,
  defaultDate,
  defaultStartsAt = "",
  locationField = "location_id",
  serviceField = "service_id",
  employeeField = "employee_id",
  startsAtName = "starts_at",
  resourceIdsName = "resource_ids",
  ignoreAppointmentId,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dateYmd, setDateYmd] = useState(defaultDate);
  const [formKey, setFormKey] = useState({ locationId: "", serviceId: "", employeeId: "" });
  const [slots, setSlots] = useState<StaffBookableSlot[]>([]);
  const [selectedLocal, setSelectedLocal] = useState(defaultStartsAt);
  const [selectedResourceNames, setSelectedResourceNames] = useState<string[]>([]);
  const [resourceIdsValue, setResourceIdsValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return undefined;

    const readForm = () => {
      setFormKey({
        locationId: fieldValue(form, locationField),
        serviceId: fieldValue(form, serviceField),
        employeeId: fieldValue(form, employeeField),
      });
    };

    form.addEventListener("change", readForm);
    const timer = window.setTimeout(readForm, 0);
    return () => {
      window.clearTimeout(timer);
      form.removeEventListener("change", readForm);
    };
  }, [employeeField, locationField, serviceField]);

  const locationId = formKey.locationId;
  const serviceId = formKey.serviceId;
  const employeeId = formKey.employeeId;
  const slotScope = `${locationId}|${serviceId}|${dateYmd}`;
  const [seenScope, setSeenScope] = useState(slotScope);
  if (slotScope !== seenScope) {
    const [prevLocationId, prevServiceId] = seenScope.split("|");
    setSeenScope(slotScope);
    if (prevLocationId && prevServiceId) {
      setSelectedLocal("");
      setSelectedResourceNames([]);
      setResourceIdsValue("");
    }
  }

  useEffect(() => {
    if (!studioId || !locationId || !serviceId) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setMessage(null);
      void listStaffBookableSlotsAction({
        studioId,
        locationId,
        serviceId,
        dateYmd,
        ignoreAppointmentId,
      }).then((result) => {
        if (cancelled) return;
        setLoading(false);
        if (!result.ok) {
          console.log("appointment slot picker failed", { studioId, locationId, serviceId, dateYmd, message: result.message });
          setSlots([]);
          setMessage(result.message);
          return;
        }
        setSlots(result.slots);
      }).catch((error: unknown) => {
        if (cancelled) return;
        console.log("appointment slot picker threw", error);
        setLoading(false);
        setSlots([]);
        setMessage("Could not load slots.");
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dateYmd, ignoreAppointmentId, locationId, serviceId, studioId]);

  const ready = Boolean(locationId && serviceId);
  const visibleSlots = useMemo(
    () => (employeeId ? slots.filter((slot) => slot.employeeId === employeeId) : slots),
    [employeeId, slots],
  );

  function applySlot(slot: StaffBookableSlot) {
    const form = rootRef.current?.closest("form") ?? null;
    setSelectedLocal(slot.startsAtLocal);
    setSelectedResourceNames(slot.resourceNames);
    setResourceIdsValue(slot.resourceIds.join(","));
    if (slot.employeeId) setFieldValue(form, employeeField, slot.employeeId);
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-2 sm:col-span-2">
      <span className={ui.label}>Available slots (SGT)</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ui.btnGhost} onClick={() => setDateYmd(shiftLocalIsoDate(dateYmd, -1))}>
          <ChevronLeft size={16} />
          Prev
        </button>
        <input
          type="date"
          className={ui.input}
          value={dateYmd}
          onChange={(event) => setDateYmd(event.target.value)}
        />
        <button type="button" className={ui.btnGhost} onClick={() => setDateYmd(shiftLocalIsoDate(dateYmd, 1))}>
          Next
          <ChevronRight size={16} />
        </button>
      </div>

      {!ready ? (
        <p className={`text-xs ${ui.muted}`}>Select location and service to see open times.</p>
      ) : loading ? (
        <p className={`text-xs ${ui.muted}`}>Loading slots…</p>
      ) : message ? (
        <p className="text-xs text-rose-700 dark:text-rose-300">{message}</p>
      ) : visibleSlots.length === 0 ? (
        <p className={`text-xs ${ui.muted}`}>No open slots on this date. Try another day or staff.</p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {visibleSlots.map((slot) => {
            const selected = selectedLocal === slot.startsAtLocal && (!employeeId || employeeId === slot.employeeId);
            const timeLabel = slot.startsAtLocal.slice(11);
            return (
              <button
                key={`${slot.startsAtIso}:${slot.employeeId}`}
                type="button"
                data-slot-local={slot.startsAtLocal}
                className={selected ? ui.btnPrimarySm : ui.btnSecondarySm}
                onClick={() => applySlot(slot)}
              >
                {employeeId ? timeLabel : `${timeLabel} · ${slot.employeeName}`}
                {slot.resourceNames.length ? ` · ${slot.resourceNames.join(", ")}` : ""}
              </button>
            );
          })}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={ui.label}>Selected time</span>
        <input
          type="datetime-local"
          name={startsAtName}
          className={ui.input}
          required
          value={selectedLocal}
          onChange={(event) => {
            setSelectedLocal(event.target.value);
            setSelectedResourceNames([]);
            setResourceIdsValue("");
          }}
        />
        {!selectedLocal ? (
          <p className={`text-xs ${ui.muted}`}>Pick a slot above, or type a time.</p>
        ) : null}
      </label>
      {selectedResourceNames.length ? (
        <p className={`text-xs ${ui.muted}`}>Assigned: {selectedResourceNames.join(", ")}</p>
      ) : null}
      <input type="hidden" name={resourceIdsName} value={resourceIdsValue} />
    </div>
  );
}
