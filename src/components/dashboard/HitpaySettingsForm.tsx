"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, CircleDashed } from "lucide-react";
import { updateStudioHitpaySettings, type HitpaySettingsResult } from "@/app/(app)/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Toggle } from "@/components/ui/Toggle";
import { ui } from "@/lib/ui";

type Props = {
  studioId: string;
  initialEnabled: boolean;
  initialBusinessName: string | null;
  initialHasApiKey: boolean;
  initialHasWebhookSalt: boolean;
};

function OnboardingStep({
  title,
  description,
  done,
}: {
  title: string;
  description: string;
  done: boolean;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center ${
            done ? "text-teal-600 dark:text-teal-400" : "text-stone-400 dark:text-stone-500"
          }`}
        >
          {done ? <CheckCircle2 size={18} /> : <CircleDashed size={18} />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                done
                  ? "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
                  : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
              }`}
            >
              {done ? "Ready" : "Pending"}
            </span>
          </div>
          <p className={`mt-1 text-sm ${ui.muted}`}>{description}</p>
        </div>
      </div>
    </div>
  );
}

export function HitpaySettingsForm({
  studioId,
  initialEnabled,
  initialBusinessName,
  initialHasApiKey,
  initialHasWebhookSalt,
}: Props) {
  const [state, formAction] = useActionState<HitpaySettingsResult | null, FormData>(
    updateStudioHitpaySettings,
    null,
  );
  const hasBusinessName = state?.hasBusinessName ?? Boolean(initialBusinessName?.trim());
  const hasApiKey = state?.hasApiKey ?? initialHasApiKey;
  const hasWebhookSalt = state?.hasWebhookSalt ?? initialHasWebhookSalt;
  const enabled = state?.enabled ?? initialEnabled;

  return (
    <form action={formAction} className={`${ui.card} grid gap-4`}>
      <input type="hidden" name="studio_id" value={studioId} />
      <div>
        <h2 className={ui.h2}>HitPay merchant setup</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          Complete this section with details from the studio HitPay merchant account. Leave existing secret fields
          blank when you only want to update the business name or enable switch.
        </p>
        <ul className={`mt-3 list-disc space-y-1 pl-5 text-sm ${ui.muted}`}>
          <li>Use the merchant API key from this studio HitPay account.</li>
          <li>Use the webhook salt configured for the same HitPay merchant.</li>
          <li>Enable HitPay only after the business name, API key, and webhook salt are ready.</li>
        </ul>
      </div>
      <label className="flex items-center gap-3 text-sm text-stone-700 dark:text-stone-300">
        <Toggle name="hitpay_enabled" defaultChecked={initialEnabled} />
        Enable HitPay for this studio
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Business name</span>
        <input
          name="hitpay_business_name"
          defaultValue={initialBusinessName ?? ""}
          placeholder="ACME Fitness Pte Ltd"
          className={ui.input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className={ui.label}>Merchant API key</span>
          {hasApiKey
            ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">Configured ✓</span>
            : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Not set</span>
          }
        </span>
        <input
          name="hitpay_api_key"
          type="password"
          defaultValue=""
          placeholder={hasApiKey ? "Leave blank to keep current key, or enter new key to rotate" : "Enter your HitPay merchant API key"}
          className={ui.input}
        />
        <span className={`text-xs ${ui.muted}`}>Use the API key from your own HitPay merchant account.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className={ui.label}>Webhook salt</span>
          {hasWebhookSalt
            ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">Configured ✓</span>
            : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Not set</span>
          }
        </span>
        <input
          name="hitpay_webhook_salt"
          type="password"
          defaultValue=""
          placeholder={hasWebhookSalt ? "Leave blank to keep current salt, or enter new salt to rotate" : "Enter your HitPay webhook salt"}
          className={ui.input}
        />
        <span className={`text-xs ${ui.muted}`}>This should match the webhook endpoint salt configured for this merchant in HitPay.</span>
      </label>

      {state ? (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            state.ok
              ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/60 dark:bg-teal-950/30 dark:text-teal-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            {state.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {state.message}
          </span>
        </div>
      ) : null}

      <SubmitButton className={`${ui.btnPrimary} w-fit`} pendingText="Saving...">
        Save settings
      </SubmitButton>

      <div className="grid gap-3 border-t border-stone-100 pt-4 dark:border-stone-800">
        <OnboardingStep
          title="1. Merchant account ready"
          description="Confirm this studio has its own HitPay merchant account and business name."
          done={hasBusinessName}
        />
        <OnboardingStep
          title="2. Credentials entered"
          description="Both the merchant API key and webhook salt must be stored before enablement."
          done={hasApiKey && hasWebhookSalt}
        />
        <OnboardingStep
          title="3. Enabled"
          description="Turn on HitPay for this studio only after the earlier steps are ready."
          done={enabled}
        />
      </div>
    </form>
  );
}
