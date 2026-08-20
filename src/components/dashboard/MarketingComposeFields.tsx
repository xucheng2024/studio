"use client";

import { useState } from "react";
import { ui } from "@/lib/ui";

export function MarketingAudienceFields() {
  const [audience, setAudience] = useState<"vip" | "frequent" | "inactive">("vip");
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Audience
        <select
          className={ui.input}
          name="audience_type"
          value={audience}
          onChange={(event) => setAudience(event.target.value as "vip" | "frequent" | "inactive")}
        >
          <option value="vip">VIP — customer value</option>
          <option value="frequent">Frequent — completed visits</option>
          <option value="inactive">Inactive — no recent completed visit</option>
        </select>
      </label>
      {audience === "vip" ? (
        <label className="flex flex-col gap-1 text-sm">
          Minimum value (SGD)
          <input className={ui.input} name="min_value" type="number" min="0" step="0.01" defaultValue="1000" />
        </label>
      ) : (
        <input type="hidden" name="min_value" value="1000" />
      )}
      {audience === "frequent" ? (
        <label className="flex flex-col gap-1 text-sm">
          Minimum visits
          <input className={ui.input} name="min_visits" type="number" min="1" step="1" defaultValue="3" />
        </label>
      ) : (
        <input type="hidden" name="min_visits" value="3" />
      )}
      {audience === "inactive" ? (
        <label className="flex flex-col gap-1 text-sm">
          Days without a visit
          <input className={ui.input} name="inactive_days" type="number" min="1" step="1" defaultValue="90" />
        </label>
      ) : (
        <input type="hidden" name="inactive_days" value="90" />
      )}
    </>
  );
}

export function MarketingOptionalContent() {
  return (
    <details className="md:col-span-2 rounded-xl border border-stone-200 px-3 py-2 dark:border-stone-800">
      <summary className="cursor-pointer text-sm font-medium text-stone-800 dark:text-stone-200">Optional image and CTA</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Image URL
          <input className={ui.input} name="image_url" type="url" placeholder="https://…" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          CTA label
          <input className={ui.input} name="cta_label" maxLength={80} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          CTA URL
          <input className={ui.input} name="cta_url" type="url" placeholder="https://…" />
        </label>
      </div>
    </details>
  );
}

export function MarketingSendTimingFields() {
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Timing
        <select
          className={ui.input}
          name="send_mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as "now" | "scheduled")}
        >
          <option value="now">Send now</option>
          <option value="scheduled">Schedule (Asia/Singapore)</option>
        </select>
      </label>
      {mode === "scheduled" ? (
        <label className="flex flex-col gap-1 text-sm">
          Scheduled time
          <input className={ui.input} name="scheduled_at" type="datetime-local" required />
        </label>
      ) : null}
    </>
  );
}
