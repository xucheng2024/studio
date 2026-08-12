"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StudioPublicBackNav } from "@/components/StudioPublicBackNav";
import { PhoneNumberInput } from "@/components/ui/PhoneNumberInput";
import { site } from "@/lib/brand";
import { detectInAppBrowser } from "@/lib/inAppBrowser";
import { createBrowserSupabase, getBrowserUser } from "@/lib/supabase/client";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { ui } from "@/lib/ui";

type OtpStep = "request" | "verify" | "profile";

export function AuthPageInner({
  memberStudioSlug: memberStudioSlugProp = null,
  memberHomePath: memberHomePathProp = null,
  memberClassesPath: memberClassesPathProp = null,
}: {
  memberStudioSlug?: string | null;
  memberHomePath?: string | null;
  memberClassesPath?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const memberScopedMatch =
    pathname.match(/^\/([a-z0-9-]{3,60})\/auth(?:\/|$)/i) ??
    pathname.match(/^\/m\/([a-z0-9-]{3,60})\/auth(?:\/|$)/i);
  const memberScopedSlug = memberStudioSlugProp ?? memberScopedMatch?.[1]?.toLowerCase() ?? null;
  const isMemberAuth = Boolean(memberScopedSlug);
  const memberHomePath = memberHomePathProp ?? (memberScopedSlug ? `/${memberScopedSlug}` : "/");
  const memberClassesPath = memberClassesPathProp ?? (memberScopedSlug ? `/${memberScopedSlug}/classes` : "/");
  const inviteToken = searchParams.get("invite_token") ?? "";
  const nextRaw = searchParams.get("next");
  const safeNext =
    nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : null;

  const postAuthPath = isMemberAuth
    ? safeNext ?? memberHomePath
    : inviteToken
      ? `/post-auth?invite_token=${encodeURIComponent(inviteToken)}&staff_portal=1`
      : safeNext ?? "/post-auth?staff_portal=1";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<OtpStep>("request");
  const [otpCode, setOtpCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [inApp] = useState(() => detectInAppBrowser());
  const [copied, setCopied] = useState(false);

  const oauthNext = encodeURIComponent(postAuthPath);
  const oauthCallbackPath = `/auth/callback?next=${oauthNext}`;

  const rememberMemberStudio = useCallback(async () => {
    if (!memberScopedSlug) return;
    await fetch("/api/member/studio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: memberScopedSlug }),
    }).catch(() => null);
  }, [memberScopedSlug]);

  const goPostAuth = useCallback(async () => {
    await rememberMemberStudio();
    router.replace(postAuthPath);
    throttledRefresh(router);
  }, [postAuthPath, rememberMemberStudio, router]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        void goPostAuth();
      }
    });
    getBrowserUser().then((user) => {
      if (user) void goPostAuth();
    }).catch(() => null);
    return () => {
      subscription.unsubscribe();
    };
  }, [goPostAuth]);

  const headingText =
    step === "verify"
      ? "Check your email"
      : step === "profile"
        ? "Complete your account"
        : isMemberAuth
          ? "Sign in or create account"
          : "Staff sign in";

  const subtitleText =
    step === "verify"
      ? "Enter the 6-digit code we sent you."
      : step === "profile"
        ? "A few details to finish setting up your account."
        : inApp.isInApp
          ? "Use your email to receive a one-time sign-in code."
          : isMemberAuth
            ? "Continue with Google, or use your email to receive a one-time code."
            : "Continue with Google or email OTP using your invited staff email.";

  return (
    <main className={`${ui.page} max-w-5xl`}>
      {isMemberAuth && memberScopedSlug ? (
        <div className="mb-4">
          <StudioPublicBackNav href={memberHomePath}>Back to studio</StudioPublicBackNav>
        </div>
      ) : null}
      <div className="grid gap-6 md:grid-cols-5 md:items-stretch">
        <section className={`${ui.card} h-full md:col-span-3 md:order-1 order-2`}>
          {isMemberAuth ? (
            <div className="mb-2 inline-flex rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:border-stone-700 dark:bg-stone-900 dark:text-teal-300">
              Member login
            </div>
          ) : null}
          <p className={ui.badge}>{isMemberAuth ? "Members" : "Staff portal"}</p>
          <h1 className={`${ui.h1} mt-3`}>
            {isMemberAuth ? "Your classes and payments — all in one place" : "Staff access only"}
          </h1>
          <p className={`mt-2 ${ui.lead}`}>
            {isMemberAuth ? site.marketing.memberIntro : "Sign in with an invited work email to access studio operations and reporting."}
          </p>
          <ul className="mt-5 flex flex-col gap-2.5 text-sm">
            {(isMemberAuth ? site.marketing.memberHighlights : [
              "Owner and manager access is invitation only.",
              "Use the same email that received your staff invite.",
              "Uninvited emails cannot access the backoffice.",
            ]).map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40"
              >
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-teal-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {isMemberAuth ? (
            <p className={`mt-5 text-sm ${ui.muted}`}>
              {site.marketing.paymentFlowNote} {site.marketing.mergeNote}
            </p>
          ) : null}
          <p className={`mt-5 text-sm ${ui.muted}`}>
            Want to look around first?{" "}
            <Link href={isMemberAuth ? memberClassesPath : "/"} className={ui.link}>
              Browse the class schedule →
            </Link>
          </p>
        </section>

        <section className={`${ui.card} mx-auto w-full max-w-md md:col-span-2 md:order-2 order-1`}>
          {isMemberAuth ? (
            <div className="mb-3 inline-flex rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-teal-700 dark:border-stone-700 dark:bg-stone-900 dark:text-teal-300">
              Member portal
            </div>
          ) : null}
          {inApp.isInApp ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Open in your browser to sign in with Google
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {`Google sign-in is blocked inside ${inApp.name}. You can still sign in with email below, or open this page in Safari / Chrome.`}
              </p>
              <button
                type="button"
                className="mt-2.5 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-50 active:opacity-80 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
                onClick={async () => {
                  const url = window.location.href;
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? "✓ Link copied — paste in Safari / Chrome" : "Copy link to open in browser"}
              </button>
            </div>
          ) : null}

          <div className="mt-2 flex flex-col gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {headingText}
              </h2>
              <p className={`text-xs ${ui.muted}`}>{subtitleText}</p>
            </div>

            {/* Google OAuth — request step only */}
            {step === "request" && !inApp.isInApp ? (
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
                <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                  <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                {loading ? "Redirecting…" : "Continue with Google"}
              </button>
            ) : null}

            {step === "request" && !inApp.isInApp ? (
              <div className="relative py-1">
                <div className="h-px w-full bg-stone-200 dark:bg-stone-800" />
                <p className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[11px] ${ui.muted} dark:bg-stone-900`}>
                  or email OTP
                </p>
              </div>
            ) : null}

            {/* Email + OTP form */}
            {step !== "profile" ? (
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
                      options: { shouldCreateUser: true },
                    });
                    setLoading(false);
                    if (error) {
                      setMsg(error.message);
                      return;
                    }
                    setStep("verify");
                    setResendSeconds(60);
                    setMsg("Code sent — check your inbox (and spam folder).");
                    return;
                  }

                  if (otpCode.trim().length !== 6) {
                    setLoading(false);
                    setMsg("Please enter a valid 6-digit OTP code.");
                    return;
                  }
                  const { data, error } = await supabase.auth.verifyOtp({
                    email: email.trim(),
                    token: otpCode.trim(),
                    type: "email",
                  });
                  setLoading(false);
                  if (error) {
                    setMsg(error.message);
                    return;
                  }
                  // New member user with no profile yet → collect name/phone
                  const meta = data.user?.user_metadata ?? {};
                  if (isMemberAuth && !meta.full_name && !meta.phone) {
                    setStep("profile");
                    setMsg(null);
                  } else {
                    await goPostAuth();
                  }
                }}
              >
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
                <button
                  type="submit"
                  disabled={loading}
                  className={`${ui.btnPrimary} w-full disabled:opacity-50`}
                >
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
                      disabled={loading || resendSeconds > 0}
                      className={`text-sm ${ui.link} disabled:cursor-not-allowed disabled:opacity-50`}
                      onClick={async () => {
                        setMsg(null);
                        setLoading(true);
                        const supabase = createBrowserSupabase();
                        const { error } = await supabase.auth.signInWithOtp({
                          email: email.trim(),
                          options: { shouldCreateUser: true },
                        });
                        setLoading(false);
                        if (error) {
                          setMsg(error.message);
                          return;
                        }
                        setResendSeconds(60);
                        setMsg("New code sent — check your inbox.");
                      }}
                    >
                      {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                    </button>
                    <button
                      type="button"
                      className={`text-sm ${ui.muted} hover:text-stone-700 dark:hover:text-stone-300`}
                      onClick={() => { setStep("request"); setOtpCode(""); setResendSeconds(0); setMsg(null); }}
                    >
                      ← Change email
                    </button>
                  </div>
                ) : null}
                {!isMemberAuth ? <p className={`text-xs ${ui.muted}`}>Workspace access is by invitation only.</p> : null}
              </form>
            ) : null}

            {/* Profile step — new member users only */}
            {step === "profile" ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  if (name.trim() || phone.trim()) {
                    await fetch("/api/account/profile", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        full_name: name.trim() || null,
                        phone: phone.trim() || null,
                      }),
                    }).catch(() => null);
                  }
                  setLoading(false);
                  await goPostAuth();
                }}
              >
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Name</span>
                  <input
                    className={ui.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Kim"
                    autoComplete="name"
                    autoFocus
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Phone</span>
                  <PhoneNumberInput value={phone} onChange={setPhone} placeholder="9123 4567" />
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  className={`${ui.btnPrimary} w-full disabled:opacity-50`}
                >
                  {loading ? "Please wait…" : "Complete setup"}
                </button>
                <button
                  type="button"
                  className={`text-sm ${ui.muted} text-center`}
                  onClick={() => void goPostAuth()}
                >
                  Skip for now
                </button>
              </form>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
