"use client";

import { useActionState } from "react";
import { updateStudioCustomDomain, type CustomDomainFormResult } from "@/app/(app)/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { CustomDomainFields } from "@/components/dashboard/CustomDomainFields";
import type { CustomDomainUiStatus } from "@/lib/customDomain";
import { ui } from "@/lib/ui";

export function CustomDomainSettingsForm({
  studioId,
  initialDomain,
  cnameTarget,
  status,
}: {
  studioId: string;
  initialDomain: string | null;
  cnameTarget: string | null;
  status: CustomDomainUiStatus;
}) {
  const [state, formAction] = useActionState<CustomDomainFormResult | null, FormData>(
    updateStudioCustomDomain,
    null,
  );

  return (
    <form action={formAction} className={`${ui.card} grid gap-3`}>
      <input type="hidden" name="studio_id" value={studioId} />
      <CustomDomainFields
        studioId={studioId}
        initialDomain={initialDomain}
        cnameTarget={cnameTarget}
        status={status}
        remoteStatus={state?.status ?? null}
      />
      {state ? (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            state.ok
              ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/30 dark:text-teal-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          {state.message}
        </div>
      ) : null}
      <SubmitButton className={`${ui.btnSecondarySm} w-full sm:w-auto`} pendingText="Saving...">
        Save domain
      </SubmitButton>
    </form>
  );
}
