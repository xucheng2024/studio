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
  onChange,
}: {
  name: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const [selected, setSelected] = useState<DayKey[]>(() => parseWeekdays(defaultValue));

  const toggle = (key: DayKey) => {
    setSelected((prev) => {
      const next = prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key];
      const value = DAYS.filter((d) => next.includes(d.key)).map((d) => d.key).join(",");
      onChange?.(value);
      return next;
    });
  };

  const value = DAYS.filter((d) => selected.includes(d.key))
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
      <input type="hidden" name={name} value={value} />
      {selected.length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Select at least one day</p>
      )}
    </div>
  );
}
