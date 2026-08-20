"use client";

import { ui } from "@/lib/ui";

export function TermsAcceptanceField({
  termsVersion,
  termsSummary,
  checked,
  onChange,
}: {
  termsVersion: { id: string; version_label: string | null } | null;
  termsSummary: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  if (!termsVersion?.id) {
    // No terms version configured for this studio yet — treat as optional, not an error.
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900/40">
        <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
          Terms & Conditions {termsVersion.version_label ? `(${termsVersion.version_label})` : ""}
        </p>
        {termsSummary ? (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-stone-700 dark:text-stone-300">
            {termsSummary}
          </pre>
        ) : (
          <p className={`mt-2 text-xs ${ui.muted}`}>No content snapshot is available for this version.</p>
        )}
      </div>
      <label className="inline-flex items-start gap-2 text-xs text-stone-600 dark:text-stone-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          I accept Terms &amp; Conditions {termsVersion.version_label ? `(${termsVersion.version_label})` : ""}.
        </span>
      </label>
    </div>
  );
}
