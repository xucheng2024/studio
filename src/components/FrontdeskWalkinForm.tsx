"use client";

import { useRouter } from "next/navigation";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { useState } from "react";
import { Banknote, CircleDollarSign, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { eventBookingErrorMessage } from "@/lib/eventBookingErrors";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { ui } from "@/lib/ui";

type WalkinTarget = {
  id: string;
  startTime: string;
  title: string;
  spotsLeft: number;
  guestPrice: number;
};

export function FrontdeskWalkinForm({
  sessions,
  events,
  disabled = false,
}: {
  sessions: WalkinTarget[];
  events: WalkinTarget[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [bookingType, setBookingType] = useState<"session" | "event">("session");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [amount, setAmount] = useState("0.00");
  const [phone, setPhone] = useState("");

  const targets = bookingType === "session" ? sessions : events;
  const formDisabled = disabled || busy || targets.length === 0;

  function targetLabel(t: { startTime: string; title: string; spotsLeft: number }) {
    const d = t.startTime ? new Date(t.startTime) : null;
    const when =
      d && !Number.isNaN(d.getTime())
        ? d.toLocaleString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            weekday: "short",
            day: "numeric",
            month: "short",
          })
        : "";
    return `${when}${when ? " · " : ""}${t.title} · ${t.spotsLeft} spots left`;
  }

  function onBookingTypeChange(next: "session" | "event") {
    setBookingType(next);
    setSelectedTargetId("");
    setAmount("0.00");
  }

  return (
    <form
      className={`${ui.card} flex flex-col gap-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const guestEmail = String(fd.get("guest_email") ?? "").trim();
        setBusy(true);
        const res = await fetch("/api/frontdesk/walkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            booking_type: bookingType,
            target_id: String(fd.get("target_id") ?? ""),
            guest_name: String(fd.get("guest_name") ?? ""),
            guest_email: guestEmail || undefined,
            guest_phone: phone.trim() || null,
            amount: Number(amount || 0),
            payment_method: String(fd.get("payment_method") ?? "cash"),
            mark_checkin: fd.get("mark_checkin") === "on",
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          toast.error(
            eventBookingErrorMessage(String(body.error ?? "")) || "Walk-in failed. Please try again.",
          );
          return;
        }
        toast.success(bookingType === "event" ? "Event walk-in created" : "Walk-in created");
        (e.currentTarget as HTMLFormElement).reset();
        setSelectedTargetId("");
        setAmount("0.00");
        setPhone("");
        throttledRefresh(router);
      }}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={ui.h2}>Walk-in booking</h2>
          <p className={ui.muted}>
            Record an in-person guest for a class session or event, capture payment, and optionally check them in now.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={ui.badgeNeutral}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
          </span>
          <span className={ui.badgeNeutral}>
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={bookingType === "session" ? ui.btnPrimarySm : ui.btnSecondarySm}
          disabled={disabled || busy}
          onClick={() => onBookingTypeChange("session")}
        >
          Class session
        </button>
        <button
          type="button"
          className={bookingType === "event" ? ui.btnPrimarySm : ui.btnSecondarySm}
          disabled={disabled || busy}
          onClick={() => onBookingTypeChange("event")}
        >
          Event
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className={ui.label}>{bookingType === "session" ? "Session" : "Event"}</span>
          <select
            name="target_id"
            className={ui.select}
            required
            disabled={formDisabled}
            value={selectedTargetId}
            onChange={(e) => {
              const nextId = e.target.value;
              setSelectedTargetId(nextId);
              const target = targets.find((item) => item.id === nextId);
              setAmount(target ? target.guestPrice.toFixed(2) : "0.00");
            }}
          >
            <option value="">
              {targets.length > 0
                ? bookingType === "session"
                  ? "Select today’s session…"
                  : "Select today’s event…"
                : bookingType === "session"
                  ? "No sessions available"
                  : "No events available"}
            </option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {targetLabel(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Guest name</span>
          <input name="guest_name" placeholder="Walk-in guest" className={ui.input} required disabled={formDisabled} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Email{bookingType === "event" ? " (required)" : ""}</span>
          <input
            name="guest_email"
            type="email"
            placeholder="name@example.com"
            className={ui.input}
            required={bookingType === "event"}
            disabled={formDisabled}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Phone</span>
          <PhoneNumberInput value={phone} onChange={setPhone} disabled={formDisabled} placeholder="9123 4567" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Amount (SGD)</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min={0}
            value={amount}
            className={ui.input}
            required
            disabled={formDisabled}
            readOnly
          />
          <span className={`${ui.muted} text-xs`}>Uses the current session or event price from the studio catalog.</span>
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
            <div className="flex min-h-11 items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300">
              <Toggle name="mark_checkin" aria-label="Check-in immediately" disabled={formDisabled} />
              <span>Check-in immediately</span>
            </div>
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
