"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banknote, CircleDollarSign, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { ui } from "@/lib/ui";

export function FrontdeskWalkinForm({
  sessions,
  disabled = false,
}: {
  sessions: { id: string; startTime: string; title: string; spotsLeft: number; guestPrice: number }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [phone, setPhone] = useState("");
  const formDisabled = disabled || busy || sessions.length === 0;

  function sessionLabel(s: { startTime: string; title: string; spotsLeft: number }) {
    const d = s.startTime ? new Date(s.startTime) : null;
    const when = d && !Number.isNaN(d.getTime())
      ? d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", weekday: "short", day: "numeric", month: "short" })
      : "";
    return `${when}${when ? " · " : ""}${s.title} · ${s.spotsLeft} spots left`;
  }

  return (
    <form
      className={`${ui.card} flex flex-col gap-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        const res = await fetch("/api/frontdesk/walkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: String(fd.get("session_id") ?? ""),
            guest_name: String(fd.get("guest_name") ?? ""),
            guest_email: String(fd.get("guest_email") ?? ""),
            guest_phone: phone.trim() || null,
            amount: Number(amount || 0),
            payment_method: String(fd.get("payment_method") ?? "cash"),
            mark_checkin: fd.get("mark_checkin") === "on",
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          toast.error(body.error ?? "Walk-in failed. Please try again.");
          return;
        }
        toast.success("Walk-in created");
        (e.currentTarget as HTMLFormElement).reset();
        setSelectedSessionId("");
        setAmount("0.00");
        setPhone("");
        router.refresh();
      }}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={ui.h2}>Walk-in booking</h2>
          <p className={ui.muted}>Record an in-person guest, capture payment, and optionally check them in now.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={ui.badgeNeutral}>{sessions.length} session{sessions.length === 1 ? "" : "s"} available</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className={ui.label}>Session</span>
          <select
            name="session_id"
            className={ui.select}
            required
            disabled={formDisabled}
            value={selectedSessionId}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedSessionId(nextId);
              const session = sessions.find((item) => item.id === nextId);
              setAmount(session ? session.guestPrice.toFixed(2) : "0.00");
            }}
          >
            <option value="">{sessions.length > 0 ? "Select today’s session…" : "No sessions available"}</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Guest name</span>
          <input name="guest_name" placeholder="Walk-in guest" className={ui.input} required disabled={formDisabled} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Email</span>
          <input name="guest_email" placeholder="name@example.com" className={ui.input} disabled={formDisabled} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Phone</span>
          <PhoneNumberInput
            value={phone}
            onChange={setPhone}
            disabled={formDisabled}
            placeholder="9123 4567"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min={0}
            value={amount}
            className={ui.input}
            required
            disabled={formDisabled}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Payment method</span>
          <select name="payment_method" className={ui.select} defaultValue="cash" disabled={formDisabled}>
            <option value="cash">Cash</option>
            <option value="hitpay">HitPay</option>
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={ui.label}>Arrival</span>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
            <Toggle name="mark_checkin" aria-label="Check-in immediately" disabled={formDisabled} />
            Check-in immediately
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={ui.btnPrimary} disabled={formDisabled}>
          {busy ? "Saving..." : "Create walk-in"}
        </button>
        <span className={`inline-flex items-center gap-1.5 text-xs ${ui.muted}`}>
          <UserPlus size={13} />
          Creates booking + payment record
        </span>
        <span className={`inline-flex items-center gap-1.5 text-xs ${ui.muted}`}>
          <Banknote size={13} />
          Cash and HitPay supported here
        </span>
        <span className={`inline-flex items-center gap-1.5 text-xs ${ui.muted}`}>
          <CircleDollarSign size={13} />
          Marked paid immediately
        </span>
      </div>
    </form>
  );
}
