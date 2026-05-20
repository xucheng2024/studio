"use client";

import type { ReactNode } from "react";

/** Client wrapper so dangerous POSTs get a single browser confirm. */
export function ConfirmForm({
  id,
  action,
  confirmMessage,
  className,
  children,
}: {
  id?: string;
  action: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      id={id}
      className={className}
      action={action}
      onSubmit={(e) => {
        if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}
