"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createPosSalonCustomerAction } from "@/app/(app)/dashboard/actions";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { ui } from "@/lib/ui";

type CustomerOption = {
  id: string;
  full_name: string;
  preferred_location_id?: string | null;
};

export function AppointmentCustomerSelect({
  customers,
  name = "salon_customer_id",
  required = false,
  studioId,
  locationId,
  initialCustomerId,
}: {
  customers: CustomerOption[];
  name?: string;
  required?: boolean;
  studioId?: string;
  locationId?: string | null;
  initialCustomerId?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(customers);
  const [selectedId, setSelectedId] = useState(initialCustomerId ?? "");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((customer) => customer.full_name.toLowerCase().includes(needle));
  }, [options, query]);

  const canCreate = Boolean(studioId);
  const phoneReady = newPhone.replace(/\D/g, "").length >= 8;

  function applyPreferredLocation(customerId: string) {
    const customer = options.find((option) => option.id === customerId);
    if (!customer?.preferred_location_id) return;
    const form = rootRef.current?.closest("form");
    const locationSelect = form?.elements.namedItem("location_id") as HTMLSelectElement | null;
    if (!locationSelect) return;
    const hasOption = Array.from(locationSelect.options).some((option) => option.value === customer.preferred_location_id);
    if (!hasOption || locationSelect.value === customer.preferred_location_id) return;
    locationSelect.value = customer.preferred_location_id;
    locationSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function createCustomer() {
    const form = rootRef.current?.closest("form") ?? null;
    const locationFromForm = form instanceof HTMLFormElement
      ? String((form.elements.namedItem("location_id") as HTMLSelectElement | null)?.value ?? "").trim()
      : "";
    const effectiveLocationId = locationFromForm || locationId || "";
    if (!studioId || !effectiveLocationId || busy) {
      console.log("appointment createCustomer missing location", { studioId, effectiveLocationId });
      toast.error("Select a location first.");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("studio_id", studioId);
      formData.set("location_id", effectiveLocationId);
      formData.set("full_name", newName);
      formData.set("phone", newPhone);
      const result = await createPosSalonCustomerAction(null, formData);
      if (!result.ok || !result.customer_id || !result.full_name) {
        console.log("appointment createCustomer failed", result);
        toast.error(result.message || "Could not create customer.");
        return;
      }
      const created = { id: result.customer_id, full_name: result.full_name };
      setOptions((current) => [created, ...current.filter((customer) => customer.id !== created.id)]);
      setSelectedId(created.id);
      setShowNew(false);
      setNewName("");
      setNewPhone("");
      setQuery("");
      toast.success(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5">
      <span className={ui.label}>Customer</span>
      {options.length > 8 ? (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={ui.input}
          placeholder="Filter customers"
          autoComplete="off"
        />
      ) : null}
      <select
        name={name}
        className={ui.select}
        required={required}
        value={selectedId}
        onChange={(event) => {
          setSelectedId(event.target.value);
          applyPreferredLocation(event.target.value);
        }}
      >
        <option value="">Select customer</option>
        {filtered.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.full_name}
          </option>
        ))}
      </select>
      {canCreate ? (
        showNew ? (
          <div className="grid gap-2 rounded-xl border border-stone-200 p-2.5 dark:border-stone-800">
            <input
              className={ui.input}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Customer name"
              autoComplete="off"
            />
            <PhoneNumberInput value={newPhone} onChange={setNewPhone} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={ui.btnPrimarySm}
                disabled={busy || !newName.trim() || !phoneReady}
                onClick={() => void createCustomer()}
              >
                Save customer
              </button>
              <button type="button" className={ui.btnGhost} onClick={() => setShowNew(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={`${ui.btnGhost} self-start`} onClick={() => setShowNew(true)}>
            New customer
          </button>
        )
      ) : null}
    </div>
  );
}
