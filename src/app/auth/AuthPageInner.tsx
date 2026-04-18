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
          <p className={ui.badge}>Get started</p>
          <h1 className={`${ui.h1} mt-3 text-2xl`}>Sign in or sign up</h1>
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
            Want to browse classes first?{" "}
            <Link href="/booking" className={ui.link}>
              Open class schedule
            </Link>
          </p>
        </section>

        <section className={`${ui.card} mx-auto w-full max-w-md md:col-span-2`}>
          <div className="mt-2 flex flex-col gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Account access</h2>
              <p className={`text-xs ${ui.muted}`}>Use Google or email OTP to continue.</p>
            </div>
            <button
              type="button"
              className={`${ui.btnSecondary} w-full disabled:opacity-60`}
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
              {loading ? "Redirecting..." : "Continue with Google"}
            </button>
            <div className="relative py-1">
              <div className="h-px w-full bg-stone-200 dark:bg-stone-800" />
              <p className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[11px] ${ui.muted} dark:bg-stone-900`}>
                or continue with email OTP
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
                      data: { full_name: name.trim() },
                    },
                  });
                  setLoading(false);
                  if (error) {
                    setMsg(error.message);
                    return;
                  }
                  setStep("verify");
                  setMsg("Verification code sent. Enter the 6-digit code from your email.");
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
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Name</span>
                <input
                  className={ui.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={step === "verify"}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Email</span>
                <input
                  type="email"
                  className={ui.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={step === "verify"}
                />
              </label>
              {step === "verify" ? (
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Email OTP code (6 digits)</span>
                  <input
                    className={ui.input}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                  />
                </label>
              ) : null}
              {msg ? (
                <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-300">
                  {msg}
                </p>
              ) : null}
              <button type="submit" disabled={loading} className={`${ui.btnPrimary} w-full disabled:opacity-50`}>
                {loading ? "Please wait..." : step === "request" ? "Send OTP code" : "Verify and continue"}
              </button>
              {step === "verify" ? (
                <button
                  type="button"
                  className={ui.btnGhost}
                  onClick={async () => {
                    setMsg(null);
                    setLoading(true);
                    const supabase = createBrowserSupabase();
                    const { error } = await supabase.auth.signInWithOtp({
                      email: email.trim(),
                      options: {
                        shouldCreateUser: true,
                        data: { full_name: name.trim() },
                      },
                    });
                    setLoading(false);
                    if (error) {
                      setMsg(error.message);
                      return;
                    }
                    setMsg("A new code has been sent.");
                  }}
                >
                  Resend code
                </button>
              ) : null}
              <p className={`text-xs ${ui.muted}`}>Workspace access is managed by invitation.</p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
