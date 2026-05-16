"use client";

import { useState, useEffect } from "react";
import { formatLocalDateTime } from "@/lib/date";

/**
 * Renders a date+time string.
 * SSR/initial render: Singapore Time (SGT) as fallback.
 * After hydration: switches to the viewer's browser local timezone.
 */
export function LocalTime({
  iso,
  options,
}: {
  iso: string | null | undefined;
  options?: Intl.DateTimeFormatOptions;
}) {
  const opts: Intl.DateTimeFormatOptions = options ?? { dateStyle: "medium", timeStyle: "short" };
  const sgt = formatLocalDateTime(iso, opts);
  const [label, setLabel] = useState(sgt);

  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setLabel(d.toLocaleString(undefined, opts));
  // opts object identity changes on every render if passed inline; iso is the real dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);

  if (!iso) return null;
  return <span suppressHydrationWarning>{label}</span>;
}
