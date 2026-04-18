"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ui } from "@/lib/ui";

export function OpsFilters({
  studios,
  locations,
  selectedStudioId,
  selectedLocationId,
  dateFrom,
  dateTo,
  status,
  reconStatus,
  query,
}: {
  studios: { id: string; name: string }[];
  locations: { id: string; name: string; studio_id: string }[];
  selectedStudioId: string | null;
  selectedLocationId: string | null;
  dateFrom: string;
  dateTo: string;
  status: string;
  reconStatus: string;
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
    <div className={`${ui.card} grid gap-3 md:grid-cols-4`}>
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
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Date from</span>
        <input
          type="date"
          className={ui.input}
          value={dateFrom}
          onChange={(e) => update({ date_from: e.target.value || null })}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Date to</span>
        <input
          type="date"
          className={ui.input}
          value={dateTo}
          onChange={(e) => update({ date_to: e.target.value || null })}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Status</span>
        <input
          className={ui.input}
          placeholder="Payment status (e.g. pending, paid)"
          defaultValue={status}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const input = e.currentTarget as HTMLInputElement;
            update({ status: input.value.trim() || null });
          }}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Payment review status</span>
        <input
          className={ui.input}
          placeholder="e.g. mismatch, awaiting_verification"
          defaultValue={reconStatus}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const input = e.currentTarget as HTMLInputElement;
            update({ recon_status: input.value.trim() || null });
          }}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Search member or payment</span>
        <input
          className={ui.input}
          placeholder="name / phone / email / reference"
          defaultValue={query}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const input = e.currentTarget as HTMLInputElement;
            update({ q: input.value.trim() || null });
          }}
        />
      </label>
    </div>
  );
}
