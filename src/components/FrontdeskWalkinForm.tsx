"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CircleDollarSign, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { eventBookingErrorMessage } from "@/lib/eventBookingErrors";
import { paymentErrorMessage } from "@/lib/paymentErrors";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { ui } from "@/lib/ui";

type WalkinTarget = {
  id: string;
  startTime?: string;
  title: string;
  spotsLeft?: number;
  guestPrice: number;
};

export function FrontdeskWalkinForm({
  sessions,
  events,
  services,
  disabled = false,
}: {
  sessions: WalkinTarget[];
  events: WalkinTarget[];
  services: WalkinTarget[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [bookingType, setBookingType] = useState<"session" | "event" | "service">("session");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [phone, setPhone] = useState("");

  const targets = bookingType === "session" ? sessions : bookingType === "event" ? events : services;
  const formDisabled = disabled || busy || targets.length === 0;
  const selectedTarget = targets.find((item) => item.id === selectedTargetId) ?? null;
  const amountLabel = selectedTarget
    ? `SGD ${selectedTarget.guestPrice.toFixed(2)}`
    : bookingType === "service"
      ? "Select a service"
      : "Select a session or event";

  function targetLabel(t: WalkinTarget) {
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
    const spotsLabel = typeof t.spotsLeft === "number" ? `${t.spotsLeft} spots left` : null;
    return [when, t.title, spotsLabel].filter(Boolean).join(" · ");
  }

  function onBookingTypeChange(next: "session" | "event" | "service") {
    setBookingType(next);
    setSelectedTargetId("");
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
            payment_method: String(fd.get("payment_method") ?? "cash"),
            mark_checkin: fd.get("mark_checkin") === "on",
          }),
        });
        const body = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
          const message =
            bookingType === "service"
              ? paymentErrorMessage(String(body.error ?? ""), body.error_detail)
              : eventBookingErrorMessage(String(body.error ?? "")) || "Walk-in failed. Please try again.";
          toast.error(message);
          return;
        }
        toast.success(
          bookingType === "event"
            ? "Event walk-in created"
            : bookingType === "service"
              ? "Service walk-in created"
              : "Walk-in created",
        );
        (e.currentTarget as HTMLFormElement).reset();
        setSelectedTargetId("");
        setPhone("");
        throttledRefresh(router);
      }}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={ui.h2}>Front desk sale</h2>
          <p className={ui.muted}>
            Record an in-person guest for a class session, event, or service, capture payment, and optionally check them in now.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={ui.badgeNeutral}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
          </span>
          <span className={ui.badgeNeutral}>
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
          <span className={ui.badgeNeutral}>
            {services.length} service{services.length === 1 ? "" : "s"}
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
        <button
          type="button"
          className={bookingType === "service" ? ui.btnPrimarySm : ui.btnSecondarySm}
          disabled={disabled || busy}
          onClick={() => onBookingTypeChange("service")}
        >
          Service
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className={ui.label}>{bookingType === "session" ? "Session" : bookingType === "event" ? "Event" : "Service"}</span>
          <select
            name="target_id"
            className={ui.select}
            required
            disabled={formDisabled}
            value={selectedTargetId}
            onChange={(e) => setSelectedTargetId(e.target.value)}
          >
            <option value="">
              {targets.length > 0
                ? bookingType === "session"
                  ? "Select today’s session…"
                  : bookingType === "event"
                    ? "Select today’s event…"
                    : "Select a service…"
                : bookingType === "session"
                  ? "No sessions available"
                  : bookingType === "event"
                    ? "No events available"
                    : "No services available"}
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
          <span className={ui.label}>Email{bookingType === "event" || bookingType === "service" ? " (required)" : ""}</span>
          <input
            name="guest_email"
            type="email"
            placeholder="name@example.com"
            className={ui.input}
            required={bookingType === "event" || bookingType === "service"}
            disabled={formDisabled}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Phone</span>
          <PhoneNumberInput value={phone} onChange={setPhone} disabled={formDisabled} placeholder="9123 4567" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Amount</span>
          <div className="flex min-h-11 items-center rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-medium text-stone-900 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-100">
            {amountLabel}
          </div>
          <span className={`${ui.muted} text-xs`}>Uses the current catalog price from the selected item.</span>
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
            <Toggle name="mark_checkin" aria-label="Check-in immediately" disabled={formDisabled || bookingType === "service"} />
            <span>{bookingType === "service" ? "Check-in is not used for services" : "Check-in immediately"}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={ui.btnPrimary} disabled={formDisabled}>
          {busy ? "Saving..." : "Create walk-in"}
        </button>
        <span className={`inline-flex items-center gap-1.5 text-xs ${ui.muted}`}>
          <UserPlus size={13} />
          Creates booking or order plus payment record
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
