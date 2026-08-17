"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, CircleDashed } from "lucide-react";
import { updateStudioEmailSettings, type EmailSettingsResult } from "@/app/(app)/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Toggle } from "@/components/ui/Toggle";
import { ui } from "@/lib/ui";

type Props = {
  studioId: string;
  webhookUrl: string;
  initialEnabled: boolean;
  initialFromEmail: string | null;
  initialHasApiKey: boolean;
  initialHasWebhookSecret: boolean;
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

export function ResendSettingsForm({
  studioId,
  webhookUrl,
  initialEnabled,
  initialFromEmail,
  initialHasApiKey,
  initialHasWebhookSecret,
}: Props) {
  const [state, formAction] = useActionState<EmailSettingsResult | null, FormData>(
    updateStudioEmailSettings,
    null,
  );
  const hasFromEmail = state?.hasFromEmail ?? Boolean(initialFromEmail?.trim());
  const hasApiKey = state?.hasApiKey ?? initialHasApiKey;
  const hasWebhookSecret = state?.hasWebhookSecret ?? initialHasWebhookSecret;
  const enabled = state?.enabled ?? initialEnabled;

  return (
    <form action={formAction} className={`${ui.card} grid gap-4`}>
      <input type="hidden" name="studio_id" value={studioId} />
      <div>
        <h2 className={ui.h2}>Resend studio setup</h2>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          Use this studio&apos;s own Resend account. Leave secret fields blank to keep the current values.
        </p>
        <ul className={`mt-3 list-disc space-y-1 pl-5 text-sm ${ui.muted}`}>
          <li>API key and From address must belong to this studio Resend account.</li>
          <li>Paste the webhook URL below into that same Resend account.</li>
          <li>Enable sending only after the API key, From address, and webhook secret are ready.</li>
        </ul>
      </div>
      <label className="flex items-center gap-3 text-sm text-stone-700 dark:text-stone-300">
        <Toggle name="resend_enabled" defaultChecked={initialEnabled} />
        Enable Resend for this studio
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className={ui.label}>From email</span>
          {hasFromEmail
            ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">Configured ✓</span>
            : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Not set</span>
          }
        </span>
        <input
          name="resend_from_email"
          type="text"
          defaultValue={initialFromEmail ?? ""}
          placeholder="Studio Name <hello@your-domain.com>"
          className={ui.input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className={ui.label}>Resend API key</span>
          {hasApiKey
            ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">Configured ✓</span>
            : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Not set</span>
          }
        </span>
        <input
          name="resend_api_key"
          type="password"
          defaultValue=""
          placeholder={hasApiKey ? "Leave blank to keep current key, or enter new key to rotate" : "Enter this studio Resend API key"}
          className={ui.input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className={ui.label}>Webhook signing secret</span>
          {hasWebhookSecret
            ? <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">Configured ✓</span>
            : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Not set</span>
          }
        </span>
        <input
          name="resend_webhook_secret"
          type="password"
          defaultValue=""
          placeholder={hasWebhookSecret ? "Leave blank to keep current secret, or enter new secret to rotate" : "Enter the Resend webhook signing secret"}
          className={ui.input}
        />
        <span className={`text-xs ${ui.muted}`}>Webhook URL: {webhookUrl}</span>
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
          title="1. From address ready"
          description="Use a verified sender on this studio Resend domain."
          done={hasFromEmail}
        />
        <OnboardingStep
          title="2. Credentials entered"
          description="API key and webhook signing secret must be stored before enablement."
          done={hasApiKey && hasWebhookSecret}
        />
        <OnboardingStep
          title="3. Enabled"
          description="Turn on Resend for this studio only after the earlier steps are ready."
          done={enabled}
        />
      </div>
    </form>
  );
}
