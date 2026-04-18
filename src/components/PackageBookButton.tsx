"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  hasEligiblePackageForSession,
  type MemberPackageForCredits,
  type SessionCreditContext,
  isPackageEligibleForSession,
} from "@/lib/memberCredits";
import { ui } from "@/lib/ui";

export function PackageBookButton({
  sessionId,
  packages,
  session,
}: {
  sessionId: string;
  packages: MemberPackageForCredits[];
  session: SessionCreditContext;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const eligible = useMemo(
    () => hasEligiblePackageForSession(packages, session),
    [packages, session],
  );

  const manualOptions = useMemo(() => {
    return packages.map((p) => ({
      pack: p,
      eligible: isPackageEligibleForSession(p, session),
    }));
  }, [packages, session]);

  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please pick another session.";
    if (code === "package_expired") return "This package has expired.";
    if (code === "no_eligible_package") {
      return "No package applies to this class location, or your packages have expired.";
    }
    if (code === "studio_mismatch" || code === "location_mismatch") {
      return "This package can't be used for this class.";
    }
    if (code === "active_booking_limit_exceeded") return "You already have several active bookings.";
    if (code === "late_cancel_limit_exceeded") return "Please contact frontdesk before booking again.";
    if (code === "insufficient_credits") return "Not enough credits for this class.";
    return "Could not complete booking.";
  };

  if (packages.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <p className={`text-xs ${ui.muted} max-w-xs text-right`}>
        Auto-apply credits (earliest expiry first)
      </p>
      <button
        type="button"
        disabled={busy || !eligible}
        className={`${ui.btnPrimarySm} w-full disabled:opacity-50 sm:w-auto`}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/book/member", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
          });
          const body = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) {
            setMsg(toFriendly(String(body.error ?? "")));
            return;
          }
          setMsg("Booked with credits");
          router.refresh();
        }}
      >
        {busy ? "Booking..." : "Book with credits"}
      </button>

      <details className="w-full max-w-xs rounded-md border border-stone-200 p-2 text-left dark:border-stone-700 sm:max-w-sm">
        <summary className={`cursor-pointer text-xs ${ui.muted}`}>
          Advanced · Manual package selection (front desk / override)
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className={`${ui.select} w-full`}
          >
            <option value="">Select a package…</option>
            {manualOptions.map(({ pack: p, eligible: en }) => (
              <option key={p.id} value={p.id} disabled={!en}>
                {p.name} · {p.credits_left} left · need {session.credits_required}
                {" · "}
                {p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : "no expiry"}
                {!en ? " (not eligible for this class)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !selected || !manualOptions.find((o) => o.pack.id === selected)?.eligible}
            className={`${ui.btnSecondarySm} w-full disabled:opacity-50`}
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
              setMsg("Booked with selected package");
              router.refresh();
            }}
          >
            {busy ? "Booking..." : "Book with selected package"}
          </button>
        </div>
      </details>

      {msg ? <span className={`text-xs ${ui.muted}`}>{msg}</span> : null}
    </div>
  );
}
