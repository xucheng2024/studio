"use client";

import { useMemo, useState } from "react";
import { ui } from "@/lib/ui";

type CustomerOption = {
  id: string;
  full_name: string;
};

export function AppointmentCustomerSelect({
  customers,
  name = "salon_customer_id",
  required = false,
}: {
  customers: CustomerOption[];
  name?: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => customer.full_name.toLowerCase().includes(needle));
  }, [customers, query]);

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ui.label}>Customer</span>
      {customers.length > 8 ? (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={ui.input}
          placeholder="Filter customers"
          autoComplete="off"
        />
      ) : null}
      <select name={name} className={ui.select} required={required} defaultValue="">
        <option value="">Select customer</option>
        {filtered.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}
