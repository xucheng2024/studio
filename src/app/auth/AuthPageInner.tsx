"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { site } from "@/lib/brand";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type OtpStep = "request" | "verify";

export function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite_token") ?? "";
  const nextRaw = searchParams.get("next");
  const safeNext =
    nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;

  const postAuthPath = inviteToken
    ? `/post-auth?invite_token=${encodeURIComponent(inviteToken)}`
    : safeNext ?? "/post-auth";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<OtpStep>("request");
  const [otpCode, setOtpCode] = useState("");

  const oauthNext = encodeURIComponent(postAuthPath);
  const oauthCallbackPath = `/auth/callback?next=${oauthNext}`;

  const goPostAuth = useCallback(async () => {
    router.replace(postAuthPath);
    router.refresh();
  }, [postAuthPath, router]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        void goPostAuth();
      }
    });
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) void goPostAuth();
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [goPostAuth]);

  return (
    <main className={`${ui.page} max-w-5xl`}>
      <div className="grid gap-6 md:grid-cols-5 md:items-stretch">
        <section className={`${ui.card} h-full md:col-span-3`}>
          <p className={ui.badge}>Members &amp; staff</p>
          <h1 className={`${ui.h1} mt-3`}>Your classes, credits &amp; payments — in one place</h1>
          <p className={`mt-2 ${ui.lead}`}>{site.marketing.memberIntro}</p>
          <ul className="mt-5 flex flex-col gap-2.5 text-sm">
            {site.marketing.memberHighlights.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40"
              >
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-teal-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className={`mt-5 text-sm ${ui.muted}`}>
            {site.marketing.paymentFlowNote} {site.marketing.mergeNote}
          </p>
          <p className={`mt-5 text-sm ${ui.muted}`}>
            Want to look around first?{" "}
            <Link href="/booking" className={ui.link}>
              Browse the class schedule →
            </Link>
          </p>
        </section>

        <section className={`${ui.card} mx-auto w-full max-w-md md:col-span-2`}>
          <div className="mt-2 flex flex-col gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {step === "verify" ? "Check your email" : "Sign in or create account"}
              </h2>
              <p className={`text-xs ${ui.muted}`}>
                {step === "verify"
                  ? "Enter the 6-digit code we sent you."
                  : "Continue with Google, or use your email to receive a one-time code."}
              </p>
            </div>
            <button
              type="button"
              className={`${ui.btnSecondary} flex w-full items-center justify-center gap-2.5 disabled:opacity-60`}
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
              {/* Google "G" icon */}
              <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              {loading ? "Redirecting…" : "Continue with Google"}
            </button>
            <div className="relative py-1">
              <div className="h-px w-full bg-stone-200 dark:bg-stone-800" />
              <p className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[11px] ${ui.muted} dark:bg-stone-900`}>
                or email OTP
              </p>
            </div>
            <form
              className="flex flex-col gap-3"
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
                  setMsg("Code sent — check your inbox (and spam folder).");
                  return;
                }
                if (otpCode.trim().length !== 6) {
                  setLoading(false);
                  setMsg("Please enter a valid 6-digit OTP code.");
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
                await goPostAuth();
              }}
            >
              {step === "request" ? (
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>
                    Your name{" "}
                    <span className={`font-normal ${ui.muted}`}>(for new accounts)</span>
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
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Email address</span>
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
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>6-digit code from email</span>
                  <input
                    className={`${ui.input} text-center tracking-[0.3em] text-lg font-semibold`}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="· · · · · ·"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </label>
              ) : null}
              {msg ? (
                <p className={`rounded-lg border px-3 py-2 text-sm ${
                  msg.toLowerCase().includes("sent") || msg.toLowerCase().includes("new code")
                    ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/50 dark:bg-teal-950/30 dark:text-teal-200"
                    : "border-red-200 bg-red-50 text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300"
                }`}>
                  {msg}
                </p>
              ) : null}
              <button type="submit" disabled={loading} className={`${ui.btnPrimary} w-full disabled:opacity-50`}>
                {loading
                  ? "Please wait…"
                  : step === "request"
                    ? "Send code to email"
                    : "Verify & sign in"}
              </button>
              {step === "verify" ? (
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className={`text-sm ${ui.link}`}
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
                      if (error) {
                        setMsg(error.message);
                        return;
                      }
                      setMsg("New code sent — check your inbox.");
                    }}
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    className={`text-sm ${ui.muted} hover:text-stone-700 dark:hover:text-stone-300`}
                    onClick={() => { setStep("request"); setOtpCode(""); setMsg(null); }}
                  >
                    ← Change email
                  </button>
                </div>
              ) : null}
              <p className={`text-xs ${ui.muted}`}>Workspace access is by invitation only.</p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
