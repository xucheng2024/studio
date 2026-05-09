"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

export type EmailFirstCheckoutPayload = {
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string | null;
};

type Step = "email" | "verify" | "details";

type Props = {
  submitLabel: string;
  busyLabel?: string;
  disabled?: boolean;
  onSubmit: (payload: EmailFirstCheckoutPayload) => Promise<{ ok: true } | { ok: false; message: string }>;
};

export function EmailFirstCheckout({ submitLabel, busyLabel = "Processing...", disabled = false, onSubmit }: Props) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedEmail = email.trim().toLowerCase();

  const submitPayload = async (payload: EmailFirstCheckoutPayload) => {
    setBusy(true);
    setMessage(null);
    const result = await onSubmit(payload);
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  };

  const continueWithEmail = async () => {
    if (!normalizedEmail) return;
    setBusy(true);
    setMessage(null);
    const checkRes = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail }),
    });
    const checkBody = await checkRes.json().catch(() => ({}));
    if (!checkRes.ok) {
      setBusy(false);
      setMessage("Enter a valid email address.");
      return;
    }
    if (checkBody.exists) {
      const supabase = createBrowserSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false },
      });
      setBusy(false);
      if (error) {
        setMessage(error.message);
        return;
      }
      setStep("verify");
      setMessage("Code sent. Check your email.");
      return;
    }
    setBusy(false);
    setStep("details");
  };

  const verifyAndContinue = async () => {
    if (otpCode.trim().length !== 6) {
      setMessage("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: otpCode.trim(),
      type: "email",
    });
    if (error) {
      setBusy(false);
      setMessage(error.message);
      return;
    }
    const result = await onSubmit({});
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  };

  return (
    <div className="flex flex-col gap-3">
      {step === "email" ? (
        <>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Email</span>
            <input
              type="email"
              className={ui.input}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <button
            type="button"
            disabled={busy || disabled || !normalizedEmail}
            className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
            onClick={() => void continueWithEmail()}
          >
            {busy ? <><Loader2 size={15} className="animate-spin" /> Checking...</> : "Continue"}
          </button>
        </>
      ) : null}

      {step === "verify" ? (
        <>
          <p className={`text-sm ${ui.muted}`}>We found an account for {normalizedEmail}. Enter the email code to continue.</p>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Email code</span>
            <input
              inputMode="numeric"
              className={ui.input}
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
              placeholder="6-digit code"
              autoComplete="one-time-code"
            />
          </label>
          <button
            type="button"
            disabled={busy || disabled || otpCode.trim().length !== 6}
            className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
            onClick={() => void verifyAndContinue()}
          >
            {busy ? <><Loader2 size={15} className="animate-spin" /> {busyLabel}</> : submitLabel}
          </button>
        </>
      ) : null}

      {step === "details" ? (
        <>
          <p className={`text-sm ${ui.muted}`}>Complete your details to continue as a guest.</p>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Name</span>
            <input
              className={ui.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Phone</span>
            <PhoneNumberInput value={phone} onChange={setPhone} placeholder="9123 4567" required />
          </label>
          <button
            type="button"
            disabled={busy || disabled || !name.trim() || !phone.trim()}
            className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
            onClick={() => void submitPayload({
              guest_name: name.trim(),
              guest_email: normalizedEmail,
              guest_phone: phone.trim(),
            })}
          >
            {busy ? <><Loader2 size={15} className="animate-spin" /> {busyLabel}</> : submitLabel}
          </button>
        </>
      ) : null}

      {message ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
          <AlertCircle size={14} className="shrink-0" />
          {message}
        </p>
      ) : null}
    </div>
  );
}
