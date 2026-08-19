"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { throttledRefresh } from "@/lib/throttledRefresh";
import type { DashboardFormResult } from "@/app/(app)/dashboard/actions";

type Props = {
  action: (prevState: DashboardFormResult | null, formData: FormData) => Promise<DashboardFormResult>;
  className?: string;
  children: React.ReactNode;
  refreshOnSuccess?: boolean;
  /** Prompt for confirmation before submitting when `fieldName`'s value is one of `dangerousValues`. */
  confirmIf?: { fieldName: string; dangerousValues: string[]; message: string };
};

export function ServerActionToastForm({
  action,
  className,
  children,
  refreshOnSuccess = true,
  confirmIf,
}: Props) {
  const router = useRouter();
  const [state, formAction] = useActionState<DashboardFormResult | null, FormData>(action, null);
  const lastMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const key = `${state.ok}:${state.message}`;
    if (lastMessageRef.current === key) return;
    lastMessageRef.current = key;
    if (state.ok) {
      toast.success(state.message);
      if (refreshOnSuccess) throttledRefresh(router);
      return;
    }
    toast.error(state.message);
  }, [router, refreshOnSuccess, state]);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (!confirmIf) return;
        const value = String(new FormData(event.currentTarget).get(confirmIf.fieldName) ?? "");
        if (confirmIf.dangerousValues.includes(value) && !window.confirm(confirmIf.message)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}
