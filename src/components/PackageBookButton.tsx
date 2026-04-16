"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";

type Pack = { id: string; name: string; credits_left: number; expiry_date: string | null };

export function PackageBookButton({
  sessionId,
  packages,
}: {
  sessionId: string;
  packages: Pack[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(packages[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please pick another session.";
    if (code === "package_expired") return "This package has expired.";
    if (code === "studio_mismatch" || code === "location_mismatch") {
      return "This package can't be used for this class.";
    }
    if (code === "active_booking_limit_exceeded") return "You already have several active bookings.";
    if (code === "late_cancel_limit_exceeded") return "Please contact frontdesk before booking again.";
    return "Could not book with this package.";
  };

  if (packages.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className={`${ui.select} h-8 w-full py-1 text-xs sm:w-64`}
      >
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.credits_left} left · {p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : "no expiry"}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !selected}
        className={`${ui.btnSecondarySm} w-full disabled:opacity-50 sm:w-auto`}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/book/package", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, client_package_id: selected }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            setMsg(toFriendly(String(body.error ?? "")));
            return;
          }
          setMsg("Booked with package");
          router.refresh();
        }}
      >
        {busy ? "Booking..." : "Book with package"}
      </button>
      {msg ? <span className={`text-xs ${ui.muted}`}>{msg}</span> : null}
    </div>
  );
}
