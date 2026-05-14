"use client";

import { Gift } from "lucide-react";
import { ui } from "@/lib/ui";

export type GiftPayload = {
  is_gift: true;
  gift_recipient_email: string;
  gift_recipient_name: string;
  gift_message: string;
};

type Props = {
  value: GiftPayload | null;
  onChange: (value: GiftPayload | null) => void;
  buyerEmail?: string | null;
};

export function GiftRecipientFields({ value, onChange, buyerEmail }: Props) {
  const isOpen = value !== null;

  const update = (patch: Partial<Omit<GiftPayload, "is_gift">>) => {
    onChange({
      is_gift: true,
      gift_recipient_email: value?.gift_recipient_email ?? "",
      gift_recipient_name: value?.gift_recipient_name ?? "",
      gift_message: value?.gift_message ?? "",
      ...patch,
    });
  };

  const toggle = () => {
    if (isOpen) {
      onChange(null);
    } else {
      onChange({ is_gift: true, gift_recipient_email: "", gift_recipient_name: "", gift_message: "" });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Toggle row — full-width, min 44px tap target */}
      <button
        type="button"
        onClick={toggle}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-left transition-colors hover:bg-stone-100 active:bg-stone-100 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:bg-stone-800"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400">
            <Gift size={15} />
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">Send as a gift</span>
            <span className="text-xs text-stone-400 dark:text-stone-500">Add recipient &amp; personal message</span>
          </span>
        </span>

        {/* Pill toggle switch */}
        <span
          aria-checked={isOpen}
          role="switch"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
            isOpen
              ? "bg-teal-500 dark:bg-teal-600"
              : "bg-stone-300 dark:bg-stone-600"
          }`}
        >
          <span
            className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
              isOpen ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </span>
      </button>

      {/* Expanded fields */}
      {isOpen ? (
        <div className="flex flex-col gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-800/50 dark:bg-teal-950/20">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>
              Recipient email <span className="text-red-500">*</span>
            </span>
            <input
              type="email"
              className={ui.input}
              value={value?.gift_recipient_email ?? ""}
              onChange={(e) => update({ gift_recipient_email: e.target.value.trim().toLowerCase() })}
              placeholder="recipient@example.com"
              autoComplete="off"
              required
            />
            {buyerEmail && value?.gift_recipient_email === buyerEmail.trim().toLowerCase() ? (
              <p className="text-xs text-red-500">Recipient cannot be yourself.</p>
            ) : null}
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Recipient name</span>
            <input
              type="text"
              className={ui.input}
              value={value?.gift_recipient_name ?? ""}
              onChange={(e) => update({ gift_recipient_name: e.target.value })}
              placeholder="Their full name"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Gift message</span>
            <textarea
              className={`${ui.input} resize-none`}
              rows={3}
              value={value?.gift_message ?? ""}
              onChange={(e) => update({ gift_message: e.target.value })}
              placeholder="Add a personal message… (optional)"
              maxLength={500}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
