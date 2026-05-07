"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { ui } from "@/lib/ui";

type Props = {
  initialName: string;
  initialPhone: string;
  nextPath: string;
  email: string;
};

export function CompleteProfileForm({ initialName, initialPhone, nextPath, email }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={`${ui.card} mt-6 grid gap-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fetch("/api/account/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: fullName.trim() || null,
            phone: phone.trim(),
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          setError(body.error === "phone_required" ? "Please enter your phone number." : "Could not save your profile.");
          return;
        }
        router.replace(nextPath);
        router.refresh();
      }}
    >
      <label className="grid gap-1.5">
        <span className={ui.label}>Email</span>
        <input type="email" className={`${ui.input} opacity-70`} value={email} disabled readOnly />
      </label>
      <label className="grid gap-1.5">
        <span className={ui.label}>Full name</span>
        <input
          className={ui.input}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Alex Kim"
          autoComplete="name"
        />
      </label>
      <label className="grid gap-1.5">
        <span className={ui.label}>Phone number</span>
        <PhoneNumberInput
          value={phone}
          onChange={setPhone}
          placeholder="9123 4567"
          required
        />
      </label>
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className={ui.btnPrimary} disabled={busy || !phone.trim()}>
          {busy ? "Saving..." : "Continue"}
        </button>
      </div>
    </form>
  );
}
