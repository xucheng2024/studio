"use client";

import { Children, isValidElement, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { DashboardFormResult } from "@/app/(app)/dashboard/actions";
import { throttledRefresh } from "@/lib/throttledRefresh";
import { ui } from "@/lib/ui";
import { useFormStatus } from "react-dom";

function collectHiddenFields(children: ReactNode): ReactNode[] {
  const fields: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "input" && (child.props as { type?: string }).type === "hidden") {
      fields.push(child);
    }
  });
  return fields;
}

function collectTriggers(children: ReactNode): ReactNode[] {
  const triggers: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "input" && (child.props as { type?: string }).type === "hidden") return;
    triggers.push(child);
  });
  return triggers;
}

function ConfirmSubmitButton({
  label,
  pendingLabel,
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${ui.btnDangerSm} !min-h-8 gap-1.5 px-2.5`} disabled={pending || disabled}>
      {pending ? (
        <>
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}

function CancelConfirmButton({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center rounded-md p-0.5 text-stone-500 transition hover:bg-red-100/80 hover:text-stone-800 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-stone-200"
      aria-label="Cancel"
      disabled={pending}
      onClick={onCancel}
    >
      <X size={14} />
    </button>
  );
}

export function ToastConfirmForm({
  action,
  confirmMessage,
  confirmLabel = "Confirm",
  pendingLabel = "Removing…",
  requireText,
  className,
  children,
}: {
  action: (prevState: DashboardFormResult | null, formData: FormData) => Promise<DashboardFormResult>;
  confirmMessage: string;
  confirmLabel?: string;
  pendingLabel?: string;
  requireText?: string;
  className?: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const router = useRouter();
  const [state, formAction] = useActionState<DashboardFormResult | null, FormData>(action, null);
  const lastMessageRef = useRef<string | null>(null);
  const fields = collectHiddenFields(children);
  const triggers = collectTriggers(children);

  useEffect(() => {
    if (!state) return;
    const key = `${state.ok}:${state.message}`;
    if (lastMessageRef.current === key) return;
    lastMessageRef.current = key;
    if (state.ok) {
      toast.success(state.message);
      throttledRefresh(router);
      return;
    }
    toast.error(state.message);
  }, [router, state]);

  if (!armed) {
    return (
      <form
        className={className}
        action={formAction}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setArmed(true);
        }}
      >
        {fields}
        {triggers}
      </form>
    );
  }

  return (
    <form
      action={formAction}
      className={`inline-flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs dark:border-red-800/50 dark:bg-red-950/20 ${className ?? ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="min-w-0 leading-snug text-red-900 dark:text-red-100">{confirmMessage}</span>
      {requireText ? (
        <label className="flex min-w-40 flex-col gap-1 text-red-900 dark:text-red-100">
          <span>Type {requireText} to confirm</span>
          <input
            className="min-h-8 rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-stone-900 outline-none focus:border-red-400 dark:border-red-900/60 dark:bg-stone-950 dark:text-stone-100"
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
          />
        </label>
      ) : null}
      {fields}
      <ConfirmSubmitButton
        label={confirmLabel}
        pendingLabel={pendingLabel}
        disabled={requireText ? confirmationText !== requireText : false}
      />
      <CancelConfirmButton onCancel={() => { setArmed(false); setConfirmationText(""); }} />
    </form>
  );
}
