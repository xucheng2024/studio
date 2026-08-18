"use client";

import { useState } from "react";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { SubmitButton } from "@/components/SubmitButton";
import { transitionPayrollRunAction } from "@/app/(app)/dashboard/actions";
import { ui } from "@/lib/ui";

type Props = {
  studioId: string;
  runId: string;
  status: "draft" | "finalised" | "paid" | "voided";
  blockerCount: number;
  paidOnDefault: string;
};

export function PayrollRunActions({ studioId, runId, status, blockerCount, paidOnDefault }: Props) {
  const [confirmFinalise, setConfirmFinalise] = useState(false);
  const canVoid = status !== "voided";

  return (
    <div className="flex flex-col gap-4">
      {status === "draft" ? (
        <div className="flex flex-col gap-3">
          {!confirmFinalise ? (
            <button
              type="button"
              className={ui.btnPrimarySm}
              disabled={blockerCount > 0}
              onClick={() => setConfirmFinalise(true)}
            >
              Finalise
            </button>
          ) : (
            <div className={`${ui.card} flex flex-col gap-3`}>
              <p className="text-sm text-stone-700 dark:text-stone-300">
                Finalise locks this month. Amounts cannot be edited. Void and recreate if a correction is needed.
              </p>
              <div className="flex flex-wrap gap-2">
                <ServerActionToastForm action={transitionPayrollRunAction}>
                  <input type="hidden" name="studio_id" value={studioId} />
                  <input type="hidden" name="run_id" value={runId} />
                  <input type="hidden" name="to_status" value="finalised" />
                  <SubmitButton className={ui.btnPrimarySm} disabled={blockerCount > 0}>Finalise</SubmitButton>
                </ServerActionToastForm>
                <button type="button" className={ui.btnSecondarySm} onClick={() => setConfirmFinalise(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {status === "finalised" ? (
        <ServerActionToastForm action={transitionPayrollRunAction} className={`${ui.card} grid gap-3 md:grid-cols-3`}>
          <input type="hidden" name="studio_id" value={studioId} />
          <input type="hidden" name="run_id" value={runId} />
          <input type="hidden" name="to_status" value="paid" />
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Paid on</span>
            <input className={ui.input} type="date" name="paid_on" required defaultValue={paidOnDefault} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Payment reference</span>
            <input className={ui.input} name="payment_reference" />
          </label>
          <div className="self-end">
            <SubmitButton className={ui.btnPrimary}>Mark paid</SubmitButton>
          </div>
        </ServerActionToastForm>
      ) : null}

      {canVoid ? (
        <details className="rounded-2xl border border-stone-200 dark:border-stone-800">
          <summary className={`${ui.btnDangerSm} cursor-pointer list-none rounded-2xl border-0`}>Void this run</summary>
          <ServerActionToastForm action={transitionPayrollRunAction} className="grid gap-3 p-4 md:grid-cols-2">
            <input type="hidden" name="studio_id" value={studioId} />
            <input type="hidden" name="run_id" value={runId} />
            <input type="hidden" name="to_status" value="voided" />
            <label className="flex flex-col gap-1.5 md:col-span-2">
              <span className={ui.label}>Void reason</span>
              <input className={ui.input} name="void_reason" required />
            </label>
            <SubmitButton className={ui.btnDangerSm}>Void run</SubmitButton>
          </ServerActionToastForm>
        </details>
      ) : null}
    </div>
  );
}
