"use client";

import { useMemo, useState } from "react";
import { submitPkg02AdjustmentForApprovalAction } from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { formatPriceOrFree } from "@/lib/priceDisplay";
import { ui } from "@/lib/ui";

export type Pkg02AdjustmentOption = {
  id: string;
  label: string;
  unitValue: number | null;
};

export function Pkg02NewAdjustmentForm({
  studioId,
  locationId,
  options,
  prefilledClientPackageId,
}: {
  studioId: string;
  locationId: string | null;
  options: Pkg02AdjustmentOption[];
  prefilledClientPackageId: string;
}) {
  const [clientPackageId, setClientPackageId] = useState(prefilledClientPackageId);
  const [deltaCredits, setDeltaCredits] = useState("");
  const selected = options.find((option) => option.id === clientPackageId) ?? null;
  const valueDelta = useMemo(() => {
    const delta = Number(deltaCredits);
    if (!selected || selected.unitValue == null || !Number.isFinite(delta) || delta === 0) return null;
    return Math.round(selected.unitValue * delta * 100) / 100;
  }, [deltaCredits, selected]);

  return (
    <details className={`chevron ${ui.card}`} open={Boolean(prefilledClientPackageId)}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-stone-900 dark:text-stone-100">
        <span>+ New credit change</span>
        <span className={`hidden text-xs font-normal sm:inline ${ui.muted}`}>Submit for a second person to approve</span>
      </summary>
      <ServerActionToastForm
        action={submitPkg02AdjustmentForApprovalAction}
        className="mt-4 grid gap-3 lg:grid-cols-2"
      >
        <input type="hidden" name="studio_id" value={studioId} />
        <input type="hidden" name="location_id" value={locationId ?? ""} />

        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className={ui.label}>Client package</span>
          <select
            name="client_package_id"
            required
            className={ui.select}
            value={clientPackageId}
            onChange={(event) => setClientPackageId(event.target.value)}
          >
            <option value="" disabled>
              Select a client package
            </option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {prefilledClientPackageId ? (
            <p className={`text-xs ${ui.muted}`}>Prefilled from the customer page.</p>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Credit change</span>
          <input
            name="requested_delta_credits"
            type="number"
            required
            className={ui.input}
            placeholder="-2"
            value={deltaCredits}
            onChange={(event) => setDeltaCredits(event.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={ui.label}>Amount change</span>
          <p className={`rounded-xl border border-stone-200 px-3 py-2.5 text-sm dark:border-stone-700 ${ui.muted}`}>
            {valueDelta == null ? "Calculated from package price" : formatPriceOrFree("$", valueDelta)}
          </p>
        </div>

        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className={ui.label}>Reason</span>
          <textarea
            name="reason"
            required
            className={ui.input}
            rows={3}
            placeholder="Describe why this manual adjustment is needed."
          />
        </label>

        <SubmitButton className={`${ui.btnPrimary} w-full lg:col-span-2 lg:w-fit`} pendingText="Submitting...">
          Submit for approval
        </SubmitButton>
      </ServerActionToastForm>
    </details>
  );
}
