"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { site } from "@/lib/brand";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ui } from "@/lib/ui";

type AuthTab = "member" | "staff" | "owner";
type MemberStep = "request" | "verify";

export default function AuthPage() {
  const router = useRouter();
  const [tab, setTab] = useState<AuthTab>(() => {
    if (typeof window === "undefined") return "member";
    const raw = new URLSearchParams(window.location.search).get("tab");
    return raw === "member" || raw === "staff" || raw === "owner" ? raw : "member";
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [memberMsg, setMemberMsg] = useState<string | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberStep, setMemberStep] = useState<MemberStep>("request");
  const [otpCode, setOtpCode] = useState("");

  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffErr, setStaffErr] = useState<string | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);

  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerRole, setOwnerRole] = useState<"owner" | "client">("owner");
  const [ownerMsg, setOwnerMsg] = useState<string | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);

  const heading = useMemo(() => {
    if (tab === "member") return "Keep your bookings, payments, and credits in one place";
    if (tab === "staff") return "Staff sign in";
    return "Create owner account";
  }, [tab]);

  return (
    <main className={`${ui.page} max-w-5xl`}>
      <div className="grid gap-6 md:grid-cols-5 md:items-stretch">
        <section className={`${ui.card} h-full md:col-span-3`}>
          <p className={ui.badge}>Get started</p>
          <h1 className={`${ui.h1} mt-3 text-2xl`}>{heading}</h1>
          <p className={`mt-2 ${ui.lead}`}>
            {tab === "owner" ? site.marketing.ownerIntro : site.marketing.memberIntro}
          </p>
          <ul className="mt-5 flex flex-col gap-2.5 text-sm">
            {(tab === "owner" ? site.marketing.ownerHighlights : site.marketing.memberHighlights).map((item) => (
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
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-stone-200/80 bg-stone-50/80 p-1 dark:border-stone-800 dark:bg-stone-900/50">
            {[
              { id: "member", label: "Member" },
              { id: "staff", label: "Staff" },
              { id: "owner", label: "Owner" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as AuthTab)}
                className={`rounded-lg px-2 py-2 text-xs font-medium transition sm:text-sm ${
                  tab === t.id
                    ? "bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-100"
                    : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "member" ? (
            <form
              className="mt-6 flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setMemberMsg(null);
                setMemberLoading(true);
                const supabase = createBrowserSupabase();
                if (memberStep === "request") {
                  const { error } = await supabase.auth.signInWithOtp({
                    email: email.trim(),
                    options: {
                      shouldCreateUser: true,
                      data: { role: "client", full_name: name.trim() },
                    },
                  });
                  setMemberLoading(false);
                  if (error) {
                    setMemberMsg(error.message);
                    return;
                  }
                  setMemberStep("verify");
                  setMemberMsg("Verification code sent. Enter the 6-digit code from your email.");
                  return;
                }
                const { error } = await supabase.auth.verifyOtp({
                  email: email.trim(),
                  token: otpCode.trim(),
                  type: "email",
                });
                setMemberLoading(false);
                if (error) {
                  setMemberMsg(error.message);
                  return;
                }
                router.replace("/booking");
                router.refresh();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Name</span>
                <input
                  className={ui.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={memberStep === "verify"}
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
                  disabled={memberStep === "verify"}
                />
              </label>
              {memberStep === "verify" ? (
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Email OTP code</span>
                  <input
                    className={ui.input}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </label>
              ) : null}
              {memberMsg ? <p className={ui.muted}>{memberMsg}</p> : null}
              <button type="submit" disabled={memberLoading} className={`${ui.btnPrimary} w-full disabled:opacity-50`}>
                {memberLoading ? "Please wait..." : memberStep === "request" ? "Send OTP code" : "Verify and continue"}
              </button>
              {memberStep === "verify" ? (
                <button
                  type="button"
                  className={ui.btnGhost}
                  onClick={async () => {
                    setMemberMsg(null);
                    setMemberLoading(true);
                    const supabase = createBrowserSupabase();
                    const { error } = await supabase.auth.signInWithOtp({
                      email: email.trim(),
                      options: {
                        shouldCreateUser: true,
                        data: { role: "client", full_name: name.trim() },
                      },
                    });
                    setMemberLoading(false);
                    if (error) {
                      setMemberMsg(error.message);
                      return;
                    }
                    setMemberMsg("A new code has been sent.");
                  }}
                >
                  Resend code
                </button>
              ) : null}
              <p className={`text-xs ${ui.muted}`}>
                Existing members sign in with OTP; new members are created automatically with the same email.
              </p>
            </form>
          ) : null}

          {tab === "staff" ? (
            <form
              className="mt-6 flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setStaffErr(null);
                setStaffLoading(true);
                const supabase = createBrowserSupabase();
                const { error } = await supabase.auth.signInWithPassword({
                  email: staffEmail,
                  password: staffPassword,
                });
                setStaffLoading(false);
                if (error) {
                  setStaffErr(error.message);
                  return;
                }
                router.replace("/dashboard");
                router.refresh();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Email</span>
                <input
                  className={ui.input}
                  type="email"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Password</span>
                <input
                  className={ui.input}
                  type="password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              {staffErr ? <p className={ui.error}>{staffErr}</p> : null}
              <button type="submit" disabled={staffLoading} className={`${ui.btnPrimary} w-full disabled:opacity-50`}>
                {staffLoading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          ) : null}

          {tab === "owner" ? (
            <form
              className="mt-6 flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setOwnerMsg(null);
                setOwnerLoading(true);
                const supabase = createBrowserSupabase();
                const { error } = await supabase.auth.signUp({
                  email: ownerEmail,
                  password: ownerPassword,
                  options: { data: { role: ownerRole } },
                });
                setOwnerLoading(false);
                if (error) {
                  setOwnerMsg(error.message);
                  return;
                }
                setOwnerMsg("Account created. Check your inbox to confirm your email.");
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Email</span>
                <input
                  className={ui.input}
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Password</span>
                <input
                  className={ui.input}
                  type="password"
                  minLength={6}
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Role</span>
                <select
                  className={ui.select}
                  value={ownerRole}
                  onChange={(e) => setOwnerRole(e.target.value as "owner" | "client")}
                >
                  <option value="owner">Studio owner</option>
                  <option value="client">Member</option>
                </select>
              </label>
              {ownerMsg ? <p className={ui.muted}>{ownerMsg}</p> : null}
              <button type="submit" disabled={ownerLoading} className={`${ui.btnPrimary} w-full disabled:opacity-50`}>
                {ownerLoading ? "Creating..." : "Create account"}
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </main>
  );
}
