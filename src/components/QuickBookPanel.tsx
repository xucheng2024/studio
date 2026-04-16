"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
    if (code === "full") return "This class is full now. Please choose another one.";
    if (code === "already_has_booking") return "You already have a booking for this class.";
    return "Could not continue. Please check your details and try again.";
  };

  if (disabled) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      {!open ? (
        <button
          type="button"
          className={ui.btnPrimarySm}
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
        >
          Book
        </button>
      ) : (
        <div
          className={`flex w-full min-w-[260px] max-w-sm flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-lg shadow-stone-900/10 dark:border-stone-700 dark:bg-stone-900`}
        >
          <p className={`${ui.h2} text-base`}>Your details</p>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Name</span>
            <input
              className={ui.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Phone (optional)</span>
            <input
              type="tel"
              className={ui.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          {error ? <p className={ui.error}>{error}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={loading}
              className={`${ui.btnPrimary} disabled:opacity-50`}
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
                    guest_phone: phone || null,
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
                  return;
                }
              }}
            >
              {loading ? "..." : "Continue to pay"}
            </button>
            <button type="button" className={ui.btnGhost} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
