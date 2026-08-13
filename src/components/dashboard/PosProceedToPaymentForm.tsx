"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { PosProceedToPaymentResult } from "@/app/(app)/dashboard/actions";
import { useRouter } from "next/navigation";

type LockErrorTone = "amber" | "red" | "stone";

function classifyLockError(message: string): { title: string; tone: LockErrorTone } {
  const m = message.toLowerCase();
  if (m.includes("empty sale") || m.includes("at least one item")) {
    return { title: "Empty sale", tone: "amber" };
  }
  if (m.includes("totals do not match") || m.includes("totals mismatch")) {
    return { title: "Totals mismatch", tone: "red" };
  }
  if (m.includes("currency mismatch") || m.includes("snapshot")) {
    return { title: "Item snapshot issue", tone: "red" };
  }
  if (m.includes("permission") || m.includes("scope") || m.includes("forbidden")) {
    return { title: "Scope/permission", tone: "stone" };
  }
  if (m.includes("draft") || m.includes("already locked")) {
    return { title: "Sale state", tone: "stone" };
  }
  return { title: "Payment precheck failed", tone: "stone" };
}

function toneClass(tone: LockErrorTone) {
  if (tone === "red") {
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
  }
  return "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300";
}

export function PosProceedToPaymentForm(props: {
  action: (prevState: PosProceedToPaymentResult | null, formData: FormData) => Promise<PosProceedToPaymentResult>;
  studioId: string;
  locationId?: string | null;
  saleId: string;
  idempotencyKey: string;
  ctaLabel?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<PosProceedToPaymentResult | null, FormData>(props.action, null);
  const lastMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const key = `${state.ok}:${state.message}`;
    if (lastMessageRef.current === key) return;
    lastMessageRef.current = key;
    if (state.ok) {
      toast.success(state.message);
      const q = new URLSearchParams();
      q.set("studio_id", props.studioId);
      if (props.locationId) q.set("location_id", props.locationId);
      q.set("sales_channel", "frontdesk");
      if (state.payment_id) q.set("payment_id", state.payment_id);
      if (state.payment_reference_code) q.set("q", state.payment_reference_code);
      router.push(`/dashboard/payments?${q.toString()}`);
      return;
    }
    toast.error(state.message);
  }, [props.locationId, props.studioId, router, state]);

  const classified = useMemo(() => {
    if (!state || state.ok) return null;
    return classifyLockError(state.message);
  }, [state]);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="studio_id" value={props.studioId} />
        <input type="hidden" name="sale_id" value={props.saleId} />
        <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />
        <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
          {props.ctaLabel ?? "Proceed to payment"}
        </button>
      </form>

      {classified && state && !state.ok ? (
        <p className={`rounded-md border px-2 py-1 text-xs ${toneClass(classified.tone)}`}>
          <span className="font-semibold">{classified.title}:</span> {state.message}
        </p>
      ) : null}
    </div>
  );
}
