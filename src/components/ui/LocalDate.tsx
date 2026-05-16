"use client";

import { useState, useEffect } from "react";
import { formatLocalDate } from "@/lib/date";

/**
 * Renders a date-only string.
 * SSR/initial render: Singapore Time (SGT) as fallback.
 * After hydration: switches to the viewer's browser local timezone.
 */
export function LocalDate({
  iso,
  options,
}: {
  iso: string | null | undefined;
  options?: Intl.DateTimeFormatOptions;
}) {
  const opts: Intl.DateTimeFormatOptions = options ?? { dateStyle: "medium" };
  const sgt = formatLocalDate(iso, opts);
  const [label, setLabel] = useState(sgt);

  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setLabel(d.toLocaleDateString(undefined, opts));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);

  if (!iso) return null;
  return <span suppressHydrationWarning>{label}</span>;
}
