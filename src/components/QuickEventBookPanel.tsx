 "use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { ui } from "@/lib/ui";

type Props = {
  slug: string;
  eventId: string;
  disabled?: boolean;
  triggerClassName?: string;
  triggerLabel?: string;
  defaultOpen?: boolean;
  hideClose?: boolean;
  embedded?: boolean;
};

export function QuickEventBookPanel({
  slug,
  eventId,
  disabled,
  triggerClassName,
  triggerLabel = "Book now",
  defaultOpen = false,
  hideClose = false,
  embedded = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toFriendly = (code: string) => {
    if (code === "full") return "This event is full.";
    if (code === "already_has_booking") return "You already have a booking for this event.";
    if (code === "hitpay_not_configured") {
      return "This studio has not configured online payment yet. Please contact the front desk.";
    }
    return "Could not continue. Please check your details and try again.";
  };

  if (disabled) return null;

  if (!open) {
    if (embedded) return null;
    return (
      <button
        type="button"
        className={triggerClassName ?? ui.btnPrimarySm}
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        {triggerLabel}
      </button>
    );
  }

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/event/book/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        event_id: eventId,
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
    if (body.checkout_url) router.push(body.checkout_url);
  };

  const formFields = (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={ui.label}>Name</span>
        <input
          className={ui.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
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
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={ui.label}>
          Phone <span className={`font-normal ${ui.muted}`}>(optional)</span>
        </span>
        <div className="flex items-center overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-stone-700 dark:bg-stone-950">
          <span className="select-none border-r border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
            +65
          </span>
          <input
            type="tel"
            inputMode="numeric"
            className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-stone-400"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            placeholder="9123 4567"
            autoComplete="tel-national"
            maxLength={8}
          />
        </div>
      </label>

      {error ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </p>
      ) : null}

      <div className={embedded ? "" : ui.mobileActionBar}>
        <button
          type="button"
          disabled={loading || !name.trim() || !email.trim()}
          className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
          onClick={handleSubmit}
        >
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Processing…
            </>
          ) : (
            <>Continue to payment</>
          )}
        </button>
      </div>
    </div>
  );

  if (embedded) return formFields;

  return (
    <div className="w-full rounded-2xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Your details</p>
        {hideClose ? null : (
          <button
            type="button"
            className={`${ui.btnGhost} p-1`}
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            aria-label="Close booking form"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {formFields}
    </div>
  );
}

