"use client";

import { useActionState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleDashed } from "lucide-react";
import { updateStudioEmailSettings, type EmailSettingsResult } from "@/app/(app)/dashboard/actions";
import { CopyUrlButton } from "@/components/CopyUrlButton";
import { SubmitButton } from "@/components/SubmitButton";
import { Toggle } from "@/components/ui/Toggle";
import { ui } from "@/lib/ui";

// Events handled by /api/webhooks/resend/[studioId].
const RESEND_WEBHOOK_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
  "email.clicked",
];

type Props = {
  studioId: string;
  webhookUrl: string;
  initialEnabled: boolean;
  initialFromEmail: string | null;
  initialHasApiKey: boolean;
  initialHasWebhookSecret: boolean;
};

function GuideStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
        {n}
      </span>
      <div className="min-w-0 space-y-1.5 text-sm text-stone-700 dark:text-stone-300">
        <p className="font-medium text-stone-900 dark:text-stone-100">{title}</p>
        {children}
      </div>
    </li>
  );
}

function ResendSetupGuide({ webhookUrl, open }: { webhookUrl: string; open: boolean }) {
  const code = "rounded bg-stone-100 px-1 py-0.5 text-xs dark:bg-stone-800";
  return (
    <details open={open} className="group rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
      <summary className="cursor-pointer text-sm font-semibold text-stone-900 dark:text-stone-100">
        How to get these values in Resend
      </summary>
      <ol className="mt-4 grid gap-4">
        <GuideStep n={1} title="Create a Resend account">
          <p>
            Sign up at{" "}
            <a href="https://resend.com" target="_blank" rel="noreferrer" className="underline">
              resend.com
            </a>{" "}
            with the studio&apos;s own email. Use one Resend account per studio.
          </p>
        </GuideStep>
        <GuideStep n={2} title="Verify your domain">
          <p>
            In Resend open <b>Domains → Add domain</b> and enter a domain you own, e.g.{" "}
            <code className={code}>yourstudio.com</code>. Add the DNS records Resend shows (SPF, DKIM and MX) at
            your domain provider, then wait until the domain shows <b>Verified</b>. This can take a few minutes to a
            few hours.
          </p>
        </GuideStep>
        <GuideStep n={3} title="Fill in From email">
          <p>
            Use any address on the verified domain, written as{" "}
            <code className={code}>Studio Name &lt;hello@yourstudio.com&gt;</code>. Customers see this name and
            address as the sender.
          </p>
        </GuideStep>
        <GuideStep n={4} title="Create an API key">
          <p>
            Open <b>API Keys → Create API key</b>, choose <b>Sending access</b> (optionally limited to your domain)
            and copy the key. It starts with <code className={code}>re_</code> and is only shown once.
          </p>
        </GuideStep>
        <GuideStep n={5} title="Add the webhook">
          <p>
            Open <b>Webhooks → Add webhook</b> and paste this endpoint URL:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className={`${code} break-all`}>{webhookUrl}</code>
            <CopyUrlButton url={webhookUrl} />
          </div>
          <p>Tick these events so delivery results show in campaign reports:</p>
          <div className="flex flex-wrap gap-1.5">
            {RESEND_WEBHOOK_EVENTS.map((event) => (
              <code key={event} className={code}>
                {event}
              </code>
            ))}
          </div>
          <p>
            After saving, open the webhook and copy its <b>Signing secret</b> (starts with{" "}
            <code className={code}>whsec_</code>).
          </p>
        </GuideStep>
        <GuideStep n={6} title="Save and enable">
          <p>
            Paste the values below, turn on <b>Enable Resend for this studio</b> and press <b>Save settings</b>. Then
            send yourself a test email from Marketing to confirm it works.
          </p>
        </GuideStep>
      </ol>
    </details>
  );
}

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
      </div>
      <ResendSetupGuide webhookUrl={webhookUrl} open={!(hasFromEmail && hasApiKey && hasWebhookSecret)} />
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
        <span className={`text-xs ${ui.muted}`}>Must use a domain verified in Resend (step 2–3).</span>
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
          placeholder={hasApiKey ? "Leave blank to keep current key, or enter new key to rotate" : "re_..."}
          className={ui.input}
        />
        <span className={`text-xs ${ui.muted}`}>Resend → API Keys (step 4).</span>
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
          placeholder={hasWebhookSecret ? "Leave blank to keep current secret, or enter new secret to rotate" : "whsec_..."}
          className={ui.input}
        />
        <span className={`flex flex-wrap items-center gap-2 text-xs ${ui.muted}`}>
          <span className="break-all">Webhook URL: {webhookUrl}</span>
          <CopyUrlButton url={webhookUrl} />
        </span>
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
