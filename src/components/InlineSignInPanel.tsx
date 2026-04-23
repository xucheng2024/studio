"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { detectInAppBrowser } from "@/lib/inAppBrowser";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type OtpStep = "request" | "verify";

function safeReturnPath(pathname: string, search: string) {
  const path = pathname.startsWith("/") ? pathname : "/";
  const qs = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  const full = `${path}${qs}`;
  if (!full.startsWith("/") || full.startsWith("//")) return "/booking";
  return full;
}

export function InlineSignInPanel() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const returnTo = safeReturnPath(pathname, search);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<OtpStep>("request");
  const [otpCode, setOtpCode] = useState("");
  const [inApp] = useState(() => detectInAppBrowser());
  const [copied, setCopied] = useState(false);

  const oauthNext = encodeURIComponent(returnTo);
  const oauthCallbackPath = `/auth/callback?next=${oauthNext}`;

  const afterSignedIn = useCallback(() => {
    setOpen(false);
    setStep("request");
    setOtpCode("");
    setMsg(null);
    router.refresh();
  }, [router]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") void afterSignedIn();
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [afterSignedIn]);

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          className={ui.btnPrimarySm}
          onClick={() => {
            setOpen(true);
            setMsg(null);
          }}
        >
          Sign in
        </button>
        <p className={`mt-1.5 text-xs ${ui.muted}`}>
          Stay on this page — use credits after you sign in. You can still book as a guest on each session below.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 w-full max-w-md rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Sign in</p>
        <button
          type="button"
          className={`${ui.btnGhost} shrink-0 px-2 py-1 text-xs`}
          onClick={() => {
            setOpen(false);
            setMsg(null);
            setStep("request");
            setOtpCode("");
          }}
        >
          Close
        </button>
      </div>

      {inApp.isInApp ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800/50 dark:bg-amber-950/30">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            Google sign-in may be blocked in {inApp.name}. Use email code below, or open in Safari / Chrome.
          </p>
          <button
            type="button"
            className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied — paste in browser" : "Copy page link"}
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <p className={`text-xs ${ui.muted}`}>
          {step === "verify"
            ? "Enter the 6-digit code from your email."
            : inApp.isInApp
              ? "We will email you a one-time sign-in code."
              : "Continue with Google, or sign in with email."}
        </p>

        {!inApp.isInApp ? (
          <button
            type="button"
            className={`${ui.btnSecondary} flex w-full items-center justify-center gap-2 disabled:opacity-60`}
            onClick={async () => {
              setMsg(null);
              setLoading(true);
              const supabase = createBrowserSupabase();
              const origin = typeof window !== "undefined" ? window.location.origin : "";
              const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: `${origin}${oauthCallbackPath}` },
              });
              setLoading(false);
              if (error) setMsg(error.message);
            }}
            disabled={loading}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
            {loading ? "Redirecting…" : "Continue with Google"}
          </button>
        ) : null}

        {!inApp.isInApp ? (
          <div className="relative py-0.5">
            <div className="h-px w-full bg-stone-200 dark:bg-stone-800" />
            <p
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[11px] ${ui.muted} dark:bg-stone-900`}
            >
              or email
            </p>
          </div>
        ) : null}

        <form
          className="flex flex-col gap-2.5"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg(null);
            setLoading(true);
            const supabase = createBrowserSupabase();
            if (step === "request") {
              const { error } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: {
                  shouldCreateUser: true,
                  ...(name.trim() ? { data: { full_name: name.trim() } } : {}),
                },
              });
              setLoading(false);
              if (error) {
                setMsg(error.message);
                return;
              }
              setStep("verify");
              setMsg("Code sent — check your inbox.");
              return;
            }
            if (otpCode.trim().length !== 6) {
              setLoading(false);
              setMsg("Please enter the 6-digit code.");
              return;
            }
            const { error } = await supabase.auth.verifyOtp({
              email: email.trim(),
              token: otpCode.trim(),
              type: "email",
            });
            setLoading(false);
            if (error) {
              setMsg(error.message);
              return;
            }
            await afterSignedIn();
          }}
        >
          {step === "request" ? (
            <label className="flex flex-col gap-1">
              <span className={ui.label}>
                Name <span className={`font-normal ${ui.muted}`}>(new accounts)</span>
              </span>
              <input
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Kim"
                autoComplete="name"
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Email</span>
            <input
              type="email"
              className={ui.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              disabled={step === "verify"}
            />
          </label>
          {step === "verify" ? (
            <label className="flex flex-col gap-1">
              <span className={ui.label}>6-digit code</span>
              <input
                className={`${ui.input} text-center tracking-[0.3em] text-lg font-semibold`}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="······"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
              />
            </label>
          ) : null}
          {msg ? (
            <p
              className={`rounded-lg border px-2.5 py-2 text-xs ${
                msg.toLowerCase().includes("sent") || msg.toLowerCase().includes("new code")
                  ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/50 dark:bg-teal-950/30 dark:text-teal-200"
                  : "border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300"
              }`}
            >
              {msg}
            </p>
          ) : null}
          <button type="submit" disabled={loading} className={`${ui.btnPrimary} w-full disabled:opacity-50`}>
            {loading ? "Please wait…" : step === "request" ? "Send code" : "Verify and sign in"}
          </button>
          {step === "verify" ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className={`text-xs ${ui.link}`}
                onClick={async () => {
                  setMsg(null);
                  setLoading(true);
                  const supabase = createBrowserSupabase();
                  const { error } = await supabase.auth.signInWithOtp({
                    email: email.trim(),
                    options: {
                      shouldCreateUser: true,
                      ...(name.trim() ? { data: { full_name: name.trim() } } : {}),
                    },
                  });
                  setLoading(false);
                  if (error) setMsg(error.message);
                  else setMsg("New code sent.");
                }}
              >
                Resend code
              </button>
              <button
                type="button"
                className={`text-xs ${ui.muted}`}
                onClick={() => {
                  setStep("request");
                  setOtpCode("");
                  setMsg(null);
                }}
              >
                Change email
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
