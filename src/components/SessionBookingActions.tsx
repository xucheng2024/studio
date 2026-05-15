"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Ticket, X, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { InlineSignInPanel } from "@/components/InlineSignInPanel";
import { QuickBookPanel } from "@/components/QuickBookPanel";
import { ui } from "@/lib/ui";

const PENDING_PASS_SESSION_KEY = "pending_class_pass_session_id";

export function SessionBookingActions({
  slug,
  sessionId,
  guestPrice,
  paymentReady,
  isSignedIn,
  creditsRequired = 0,
}: {
  slug: string;
  sessionId: string;
  guestPrice: number | null;
  paymentReady: boolean;
  isSignedIn: boolean;
  creditsRequired?: number;
}) {
  const router = useRouter();
  const [busyPass, setBusyPass] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showPayForm, setShowPayForm] = useState(isSignedIn);
  const [passError, setPassError] = useState<string | null>(null);

  useEffect(() => {
    if (isSignedIn) setShowPayForm(true);
  }, [isSignedIn]);

  const toFriendly = (code: string) => {
    if (code === "full") return "This class is full. Please pick another session.";
    if (code === "insufficient_credits") return "Not enough class passes for this class.";
    if (code === "no_eligible_package") return "No eligible class pass for this session.";
    if (code === "unauthorized") return "Please sign in to use class pass booking.";
    if (code === "active_booking_limit_exceeded") return "You already have several active bookings.";
    if (code === "late_cancel_limit_exceeded") return "Please contact front desk before booking again.";
    return "Could not book with class pass.";
  };

  const bookWithPass = useCallback(async () => {
    setBusyPass(true);
    const res = await fetch("/api/book/member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyPass(false);
    if (!res.ok) {
      const msg = toFriendly(String(body.error ?? ""));
      setPassError(msg);
      toast.error(msg);
      return false;
    }
    setPassError(null);
    toast.success("Booked with class pass");
    router.refresh();
    return true;
  }, [router, sessionId]);

  useEffect(() => {
    if (!isSignedIn) return;
    const pendingSession = typeof window !== "undefined" ? window.sessionStorage.getItem(PENDING_PASS_SESSION_KEY) : null;
    if (pendingSession !== sessionId) return;
    window.sessionStorage.removeItem(PENDING_PASS_SESSION_KEY);
    queueMicrotask(() => {
      void bookWithPass();
    });
  }, [isSignedIn, sessionId, bookWithPass]);

  const hasGuestPrice = guestPrice != null && guestPrice > 0;

  // Session doesn't accept class passes — show pay form directly
  if (creditsRequired === 0) {
    if (!hasGuestPrice) {
      return <p className={`text-sm ${ui.muted}`}>Price unavailable for this session.</p>;
    }
    return (
      <>
        <div className="flex flex-col gap-3">
          {showPayForm ? (
            <>
              <QuickBookPanel
                slug={slug}
                sessionId={sessionId}
                payLabel={`Pay $${guestPrice.toFixed(2)}`}
                disabled={!paymentReady}
                defaultOpen
                hideClose
                embedded
              />
            </>
          ) : (
            <button
              type="button"
              disabled={!paymentReady}
              className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
              onClick={() => setShowPayForm(true)}
            >
              <ChevronDown size={15} />
              Pay ${guestPrice.toFixed(2)}
            </button>
          )}
        </div>
        {showSignIn ? <SignInOverlay onClose={() => setShowSignIn(false)} /> : null}
      </>
    );
  }

  return (
    <>
      <div className="flex w-full flex-col gap-3">
        {/* ── Primary: Use class pass ── */}
        <button
          type="button"
          disabled={busyPass || !paymentReady}
          className={`${ui.btnPrimary} w-full justify-center disabled:opacity-50`}
          onClick={async () => {
            setPassError(null);
            if (!isSignedIn) {
              if (typeof window !== "undefined") {
                window.sessionStorage.setItem(PENDING_PASS_SESSION_KEY, sessionId);
              }
              setShowSignIn(true);
              return;
            }
            await bookWithPass();
          }}
        >
          {busyPass ? (
            <><Loader2 size={15} className="animate-spin" /> Booking…</>
          ) : (
            <><Ticket size={15} /> Use class pass</>
          )}
        </button>

        {/* Inline pass error */}
        {passError ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="mt-0.5 shrink-0 text-base leading-none">⚠</span>
            <span>{passError}</span>
          </div>
        ) : null}

        {hasGuestPrice ? (
          <>
            {/* ── Divider ── */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
              <span className="text-xs text-stone-400 dark:text-stone-500">or</span>
              <div className="h-px flex-1 bg-stone-200 dark:bg-stone-700" />
            </div>

            {/* ── Secondary: Pay (expands to form) ── */}
            {showPayForm ? (
              <div className="flex flex-col gap-3">
                <QuickBookPanel
                  slug={slug}
                  sessionId={sessionId}
                  payLabel={`Pay $${guestPrice.toFixed(2)}`}
                  disabled={!paymentReady}
                  defaultOpen
                  hideClose
                  embedded
                />
              </div>
            ) : (
              <button
                type="button"
                disabled={!paymentReady}
                className={`${ui.btnSecondary} w-full justify-center gap-2 disabled:opacity-50`}
                onClick={() => setShowPayForm(true)}
              >
                <ChevronDown size={15} />
                Pay ${guestPrice.toFixed(2)}
              </button>
            )}
          </>
        ) : (
          <p className={`text-xs ${ui.muted}`}>Guest pay is unavailable for this session.</p>
        )}
      </div>

      {showSignIn ? <SignInOverlay onClose={() => setShowSignIn(false)} /> : null}
    </>
  );
}

function SignInOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-md">
        <button
          type="button"
          aria-label="Close sign-in"
          className={`${ui.btnGhost} absolute -top-10 right-0 border border-white/30 bg-black/30 text-white hover:bg-black/50`}
          onClick={onClose}
        >
          <X size={14} />
          Close
        </button>
        <InlineSignInPanel defaultOpen hideTrigger />
      </div>
    </div>
  );
}
