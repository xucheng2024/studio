"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

type ServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
};

export function AppointmentServiceSelect({
  services,
  name = "service_id",
  required = false,
  defaultValue = "",
}: {
  services: ServiceOption[];
  name?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  const [serviceId, setServiceId] = useState(defaultValue);
  const selected = services.find((service) => service.id === serviceId);

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ui.label}>Service</span>
      <select
        name={name}
        className={ui.select}
        required={required}
        defaultValue={defaultValue}
        onChange={(event) => setServiceId(event.target.value)}
      >
        <option value="">Select service</option>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>
      {selected ? (
        <p className={`text-xs ${ui.muted}`}>Usually {selected.durationMinutes} min. End time is calculated automatically.</p>
      ) : (
        <p className={`text-xs ${ui.muted}`}>End time is calculated from the service duration.</p>
      )}
    </label>
  );
}
