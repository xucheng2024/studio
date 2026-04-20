"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, X, AlertCircle } from "lucide-react";
import { ui } from "@/lib/ui";

type Props = {
  slug: string;
  sessionId: string;
  disabled?: boolean;
};

export function QuickBookPanel({ slug, sessionId, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please choose another session.";
    if (code === "already_has_booking") return "You already have a booking for this session.";
    if (code === "PAYNOW_NOT_CONFIGURED")
      return "This studio has not configured PayNow yet. Please contact the front desk.";
    return "Could not continue. Please check your details and try again.";
  };

  if (disabled) return null;

  if (!open) {
    return (
      <button
        type="button"
        className={ui.btnPrimarySm}
        onClick={() => { setOpen(true); setError(null); }}
      >
        <ArrowRight size={13} />
        Book as guest
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Your details</p>
        <button
          type="button"
          className={`${ui.btnGhost} p-1`}
          onClick={() => { setOpen(false); setError(null); }}
          aria-label="Close booking form"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Name</span>
          <input
            className={ui.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Kim"
            autoComplete="name"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ui.label}>Email</span>
          <input
            type="email"
            className={ui.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alex@example.com"
            autoComplete="email"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`${ui.label}`}>
            Phone{" "}
            <span className={`font-normal ${ui.muted}`}>(optional)</span>
          </span>
          <div className="flex items-center overflow-hidden rounded-lg border border-stone-300 bg-white focus-within:ring-2 focus-within:ring-teal-500 dark:border-stone-700 dark:bg-stone-900">
            <span className="select-none border-r border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
              +65
            </span>
            <input
              type="tel"
              inputMode="numeric"
              className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-stone-400"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="9123 4567"
              autoComplete="tel-national"
              maxLength={8}
            />
          </div>
        </label>

        {error ? (
          <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={13} />
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={loading || !name.trim() || !email.trim()}
          className={`${ui.btnPrimary} justify-center disabled:opacity-50`}
          onClick={async () => {
            setLoading(true);
            setError(null);
            const res = await fetch("/api/book/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                slug,
                session_id: sessionId,
                guest_name: name,
                guest_email: email,
                guest_phone: phone.trim() || null,
              }),
            });
            const body = await res.json().catch(() => ({}));
            setLoading(false);
            if (!res.ok) {
              setError(toFriendly(String(body.error ?? "")));
              return;
            }
            if (body.checkout_url) {
              router.push(body.checkout_url);
            }
          }}
        >
          {loading ? (
            <><Loader2 size={15} className="animate-spin" /> Processing…</>
          ) : (
            <><ArrowRight size={15} /> Continue to pay</>
          )}
        </button>
      </div>
    </div>
  );
}
