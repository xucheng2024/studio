"use client";

import { useMemo } from "react";

/**
 * A datetime-local input that prefills with the next round hour in the
 * browser's local timezone (e.g. at 2:40 PM → default is 3:00 PM tomorrow if
 * today's slot would be in the past).
 */
export function DefaultDatetimeInput({
  name,
  required,
  className,
}: {
  name: string;
  required?: boolean;
  className?: string;
}) {
  const defaultValue = useMemo(() => {
    const now = new Date();
    // Round up to next full hour
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    // If the computed time is more than 30 min in the past somehow, push one more hour
    if (next.getTime() - now.getTime() < 30 * 60 * 1000) {
      next.setHours(next.getHours() + 1);
    }
    // Format as "YYYY-MM-DDTHH:MM" in LOCAL time (timezone-naive, as datetime-local expects)
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}` +
      `T${pad(next.getHours())}:00`
    );
  }, []);

  return (
    <input
      name={name}
      type="datetime-local"
      required={required}
      defaultValue={defaultValue}
      className={className}
    />
  );
}
