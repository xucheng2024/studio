"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Toggle } from "@/components/ui/Toggle";
import { ui } from "@/lib/ui";

export function FrontdeskWalkinForm({
  sessions,
}: {
  sessions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <form
      className={`${ui.card} grid gap-3 md:grid-cols-2`}
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
            guest_phone: String(fd.get("guest_phone_local") ?? "").trim(),
            amount: Number(fd.get("amount") ?? 0),
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
        router.refresh();
      }}
    >
      <label className="flex flex-col gap-1.5 md:col-span-2">
        <span className={ui.label}>Session</span>
        <select name="session_id" className={ui.select} required>
          <option value="">Select…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <input name="guest_name" placeholder="Name" className={ui.input} required />
      <div className="flex items-center overflow-hidden rounded-lg border border-stone-300 bg-white focus-within:ring-2 focus-within:ring-teal-500 dark:border-stone-700 dark:bg-stone-900">
        <span className="select-none border-r border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400">
          +65
        </span>
        <input
          name="guest_phone_local"
          type="tel"
          inputMode="numeric"
          placeholder="9123 4567"
          autoComplete="tel-national"
          maxLength={8}
          className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-stone-400"
        />
      </div>
      <input name="guest_email" placeholder="Email" className={ui.input} />
      <input name="amount" type="number" step="0.01" min={0} defaultValue={0} className={ui.input} required />
      <select name="payment_method" className={ui.select}>
        <option value="cash">cash</option>
        <option value="paynow">paynow</option>
      </select>
      <label className="flex items-center gap-3 text-sm text-stone-700 dark:text-stone-300">
        <Toggle name="mark_checkin" aria-label="Check-in immediately" />
        Check-in immediately
      </label>
      <button type="submit" className={`${ui.btnPrimary} w-fit md:col-span-2`} disabled={busy}>
        {busy ? "Saving..." : "Create walk-in"}
      </button>
    </form>
  );
}
