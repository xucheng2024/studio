"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PAYMENT_STATUS_FILTER_OPTIONS } from "@/lib/payment-filter-options";
import { ui } from "@/lib/ui";

export function OpsFilters({
  studios,
  locations,
  selectedStudioId,
  selectedLocationId,
  dateFrom,
  dateTo,
  status,
  query,
}: {
  studios: { id: string; name: string }[];
  locations: { id: string; name: string; studio_id: string }[];
  selectedStudioId: string | null;
  selectedLocationId: string | null;
  dateFrom: string;
  dateTo: string;
  status: string;
  query: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();

  const update = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v) params.delete(k);
      else params.set(k, v);
    }
    const q = params.toString();
    router.push(q ? `${pathname}?${q}` : pathname);
  };

  const visibleLocations = selectedStudioId
    ? locations.filter((l) => l.studio_id === selectedStudioId)
    : locations;

  return (
    <div className={`${ui.card} grid gap-3 md:grid-cols-2 lg:grid-cols-4`}>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Studio</span>
        <select
          className={ui.select}
          value={selectedStudioId ?? ""}
          onChange={(e) => {
            const value = e.target.value || null;
            update({ studio_id: value, location_id: null });
          }}
        >
          {studios.length > 1 ? <option value="">Select studio</option> : null}
          {studios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Location</span>
        <select
          className={ui.select}
          value={selectedLocationId ?? ""}
          onChange={(e) => update({ location_id: e.target.value || null })}
        >
          <option value="">All locations</option>
          {visibleLocations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="md:col-span-2 lg:col-span-2 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={`${ui.label} whitespace-nowrap`}>Date from</span>
          <input
            type="date"
            className={`${ui.input} whitespace-nowrap`}
            value={dateFrom}
            onChange={(e) => update({ date_from: e.target.value || null })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={`${ui.label} whitespace-nowrap`}>Date to</span>
          <input
            type="date"
            className={`${ui.input} whitespace-nowrap`}
            value={dateTo}
            onChange={(e) => update({ date_to: e.target.value || null })}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Payment status</span>
        <select
          className={ui.select}
          value={status}
          onChange={(e) => update({ status: e.target.value || null })}
        >
          <option value="">All</option>
          {PAYMENT_STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Search</span>
        <input
          className={ui.input}
          placeholder="name / phone / email / reference"
          defaultValue={query}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            update({ q: (e.currentTarget as HTMLInputElement).value.trim() || null });
          }}
          onBlur={(e) => {
            const val = e.currentTarget.value.trim() || null;
            if (val !== (query || null)) update({ q: val });
          }}
        />
      </label>
    </div>
  );
}
