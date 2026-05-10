"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle } from "lucide-react";
import { ui } from "@/lib/ui";

export function ContactForm() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [fields, setFields] = useState({ name: "", studioName: "", email: "", message: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name,
          studioName: fields.studioName,
          email: fields.email,
          message: fields.message || undefined,
        }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-teal-200/60 bg-teal-50/80 px-8 py-10 text-center dark:border-teal-800/40 dark:bg-teal-950/30">
        <span className="flex size-12 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/60">
          <CheckCircle size={22} className="text-teal-600 dark:text-teal-400" />
        </span>
        <p className="text-base font-semibold text-stone-900 dark:text-white">We&apos;ll be in touch soon</p>
        <p className="max-w-xs text-sm text-stone-500 dark:text-stone-400">
          Thanks for reaching out. We&apos;ll contact you at <strong className="text-stone-700 dark:text-stone-300">{fields.email}</strong> within one business day.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md rounded-2xl border border-stone-200/80 bg-white p-6 shadow-xl shadow-stone-900/8 dark:border-stone-700/60 dark:bg-stone-900"
    >
      <p className="mb-5 text-base font-semibold text-stone-900 dark:text-white">Get in touch</p>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`${ui.label} mb-1.5 block text-xs`}>Your name</label>
            <input
              required
              type="text"
              placeholder="Jane Lim"
              value={fields.name}
              onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
              className={ui.input}
            />
          </div>
          <div>
            <label className={`${ui.label} mb-1.5 block text-xs`}>Studio name</label>
            <input
              required
              type="text"
              placeholder="Lotus Yoga"
              value={fields.studioName}
              onChange={(e) => setFields((f) => ({ ...f, studioName: e.target.value }))}
              className={ui.input}
            />
          </div>
        </div>

        <div>
          <label className={`${ui.label} mb-1.5 block text-xs`}>Email address</label>
          <input
            required
            type="email"
            placeholder="jane@lotusstudio.com"
            value={fields.email}
            onChange={(e) => setFields((f) => ({ ...f, email: e.target.value }))}
            className={ui.input}
          />
        </div>

        <div>
          <label className={`${ui.label} mb-1.5 block text-xs`}>
            Tell us about your studio <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <textarea
            rows={3}
            placeholder="e.g. Yoga studio in Tanjong Pagar, ~50 members, looking to replace manual booking..."
            value={fields.message}
            onChange={(e) => setFields((f) => ({ ...f, message: e.target.value }))}
            className={`${ui.input} resize-none`}
          />
        </div>
      </div>

      {state === "error" && (
        <p className={`mt-3 ${ui.error}`}>Something went wrong — please try again or email us directly.</p>
      )}

      <button
        type="submit"
        disabled={state === "busy"}
        className={`${ui.btnPrimary} mt-4 w-full disabled:opacity-60`}
      >
        {state === "busy" ? "Sending…" : <>Send enquiry <ArrowRight size={15} /></>}
      </button>

      <p className="mt-3 text-center text-xs text-stone-400">
        We typically respond within one business day.
      </p>
    </form>
  );
}
