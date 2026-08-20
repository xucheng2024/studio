"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

export function MembershipTrialFields() {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
          <input
            name="trial_enabled"
            type="checkbox"
            className="accent-teal-600"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Offer a trial
        </label>
        {enabled ? (
          <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            <span className={ui.muted}>Days</span>
            <input
              name="trial_days"
              type="number"
              min={1}
              max={60}
              step="1"
              defaultValue={14}
              className={`${ui.input} w-24`}
            />
          </label>
        ) : null}
      </div>
      {enabled ? (
        <p className={`text-xs ${ui.muted}`}>Shown on the public membership page.</p>
      ) : null}
    </div>
  );
}
