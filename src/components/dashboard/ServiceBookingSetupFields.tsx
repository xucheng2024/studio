"use client";

import { useMemo, useState } from "react";
import { ui } from "@/lib/ui";

const DURATION_PRESETS = [30, 45, 60, 90, 120];

export function DurationPresetField({
  name,
  defaultValue,
  label = "Duration (mins)",
}: {
  name: string;
  defaultValue: number;
  label?: string;
}) {
  const [value, setValue] = useState(String(defaultValue));
  const numeric = Number(value);

  return (
    <div className="flex flex-col gap-1.5">
      <span className={ui.label}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {DURATION_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={numeric === preset ? ui.btnPrimarySm : ui.btnSecondarySm}
            onClick={() => setValue(String(preset))}
          >
            {preset}m
          </button>
        ))}
      </div>
      <input
        name={name}
        type="number"
        min="1"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={ui.input}
        aria-label={label}
      />
    </div>
  );
}

export function EligibleStaffPicker({
  employees,
  selectedIds,
}: {
  employees: Array<{ id: string; display_name: string | null }>;
  selectedIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selectedIds));
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter((employee) => (employee.display_name ?? "").toLowerCase().includes(needle));
  }, [employees, query]);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={ui.btnSecondarySm}
          onClick={() => setChecked(new Set(employees.map((employee) => employee.id)))}
        >
          Select all
        </button>
        <button type="button" className={ui.btnGhost} onClick={() => setChecked(new Set())}>
          Clear
        </button>
      </div>
      {employees.length > 8 ? (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={ui.input}
          placeholder="Filter staff"
          autoComplete="off"
        />
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map((employee) => (
          <label key={employee.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="employee_ids"
              value={employee.id}
              checked={checked.has(employee.id)}
              onChange={(event) => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (event.target.checked) next.add(employee.id);
                  else next.delete(employee.id);
                  return next;
                });
              }}
            />
            <span>{employee.display_name ?? "Unnamed staff"}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ServiceLocationScopeFields({
  locations,
  defaultScope,
  enabledLocationIds,
}: {
  locations: Array<{ id: string; name: string }>;
  defaultScope: "all_locations" | "selected_locations";
  enabledLocationIds: string[];
}) {
  const [allLocations, setAllLocations] = useState(defaultScope !== "selected_locations");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(enabledLocationIds));

  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allLocations}
          onChange={(event) => setAllLocations(event.target.checked)}
        />
        All locations
      </label>
      <input type="hidden" name="publish_scope" value={allLocations ? "all_locations" : "selected_locations"} />
      {allLocations ? null : (
        <div className="grid gap-2 sm:grid-cols-2">
          {locations.map((location) => (
            <label key={location.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="location_ids"
                value={location.id}
                checked={selected.has(location.id)}
                onChange={(event) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (event.target.checked) next.add(location.id);
                    else next.delete(location.id);
                    return next;
                  });
                }}
              />
              <span>{location.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
