"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { site } from "@/lib/brand";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type OtpStep = "request" | "verify";

export default function AuthPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<OtpStep>("request");
  const [otpCode, setOtpCode] = useState("");
  const [inviteToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("invite_token") ?? "";
  });

  const postAuthPath = inviteToken ? `/post-auth?invite_token=${encodeURIComponent(inviteToken)}` : "/post-auth";

  const goPostAuth = useCallback(async () => {
    router.replace(postAuthPath);
    router.refresh();
  }, [postAuthPath, router]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) void goPostAuth();
    });
  }, [goPostAuth]);

  return (
    <main className={`${ui.page} max-w-5xl`}>
      <div className="grid gap-6 md:grid-cols-5 md:items-stretch">
        <section className={`${ui.card} h-full md:col-span-3`}>
          <p className={ui.badge}>Get started</p>
          <h1 className={`${ui.h1} mt-3 text-2xl`}>Sign in or create your account</h1>
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
          <div className="mt-6 flex flex-col gap-4">
            <button
              type="button"
              className={`${ui.btnSecondary} w-full`}
              onClick={async () => {
                setMsg(null);
                setLoading(true);
                const supabase = createBrowserSupabase();
                const origin = typeof window !== "undefined" ? window.location.origin : "";
                const { error } = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: { redirectTo: `${origin}${postAuthPath}` },
                });
                setLoading(false);
                if (error) setMsg(error.message);
              }}
              disabled={loading}
            >
              {loading ? "Redirecting..." : "Continue with Google"}
            </button>
            <p className={`text-xs text-center ${ui.muted}`}>or continue with email OTP</p>
            <form
              className="flex flex-col gap-4"
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
              {msg ? <p className={ui.muted}>{msg}</p> : null}
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
