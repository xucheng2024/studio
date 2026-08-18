"use client";

import { useMemo, useState } from "react";
import { closePosCashSessionAction } from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { ui } from "@/lib/ui";

function money(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function CloseCashSessionForm({
  studioId,
  sessionId,
  idempotencyKey,
  expectedCash,
}: {
  studioId: string;
  sessionId: string;
  idempotencyKey: string;
  expectedCash: number;
}) {
  const expected = Number(expectedCash) || 0;
  const [counted, setCounted] = useState(money(expected));
  const [notes, setNotes] = useState("");
  const countedNum = Number(counted);
  const delta = useMemo(() => {
    if (!Number.isFinite(countedNum)) return null;
    return Math.round((countedNum - expected) * 100) / 100;
  }, [countedNum, expected]);
  const mismatch = delta != null && Math.abs(delta) >= 0.005;

  return (
    <ServerActionToastForm action={closePosCashSessionAction} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="studio_id" value={studioId} />
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Counted cash (SGD)</span>
        <input
          name="counted_cash"
          type="number"
          step="0.01"
          min="0"
          className={ui.input}
          required
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
        />
      </label>
      <div className="flex flex-col justify-end">
        <p className={`text-sm ${mismatch ? "text-amber-700 dark:text-amber-300" : ui.muted}`}>
          {delta == null
            ? "Enter counted cash to compare with expected."
            : mismatch
              ? `Over/short: SGD ${money(delta)}`
              : "Matches expected cash"}
        </p>
      </div>
      <label className="md:col-span-2 flex flex-col gap-1.5">
        <span className={ui.label}>Close note</span>
        <input
          name="notes"
          className={ui.input}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          required={mismatch}
          placeholder={mismatch ? "Required for over/short" : "Optional discrepancy/handover note"}
        />
      </label>
      <div className="md:col-span-2">
        <button type="submit" className={ui.btnPrimary}>Close cash session</button>
      </div>
    </ServerActionToastForm>
  );
}
