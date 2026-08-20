"use client";

import { useState } from "react";

const DAYS = [
  { key: "mon", label: "Mo" },
  { key: "tue", label: "Tu" },
  { key: "wed", label: "We" },
  { key: "thu", label: "Th" },
  { key: "fri", label: "Fr" },
  { key: "sat", label: "Sa" },
  { key: "sun", label: "Su" },
] as const;

type DayKey = (typeof DAYS)[number]["key"];

function parseWeekdays(value: string): DayKey[] {
  const valid = new Set(DAYS.map((d) => d.key));
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is DayKey => valid.has(s as DayKey));
}

export function WeekdayPicker({
  name,
  defaultValue = "mon,wed",
  value,
  onChange,
}: {
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState<DayKey[]>(() => parseWeekdays(defaultValue));
  const selected = value != null ? parseWeekdays(value) : uncontrolled;

  const toggle = (key: DayKey) => {
    const current = value != null ? parseWeekdays(value) : uncontrolled;
    const next = current.includes(key) ? current.filter((d) => d !== key) : [...current, key];
    const nextValue = DAYS.filter((d) => next.includes(d.key)).map((d) => d.key).join(",");
    if (value == null) setUncontrolled(next);
    onChange?.(nextValue);
  };

  const joined = DAYS.filter((d) => selected.includes(d.key))
    .map((d) => d.key)
    .join(",");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5 flex-wrap">
        {DAYS.map(({ key, label }) => {
          const isOn = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className={`h-9 w-9 rounded-full text-sm font-medium transition-colors select-none ${
                isOn
                  ? "bg-teal-500 text-white hover:bg-teal-600"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <input type="hidden" name={name} value={joined} />
      {selected.length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Select at least one day</p>
      )}
    </div>
  );
}
