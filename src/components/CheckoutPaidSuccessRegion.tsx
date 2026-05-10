"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Focus + polite announcement when the paid-success panel appears (e.g. after refresh).
 */
export function CheckoutPaidSuccessRegion({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className={className}
    >
      {children}
    </div>
  );
}
