"use client";

import { useState } from "react";
import { addHoursToLocalInput, nextHourLocalInput, parseDatetimeLocalAsSgt, toLocalDateTimeInputValue } from "@/lib/date";
import { ui } from "@/lib/ui";

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

export function EventScheduleFields() {
  const [startTime, setStartTime] = useState(() => nextHourLocalInput());
  const [endTime, setEndTime] = useState(() => addHoursToLocalInput(startTime, 2));
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);

  function onStartChange(nextStart: string) {
    setStartTime(nextStart);
    const start = parseDatetimeLocalAsSgt(nextStart);
    if (!start) return;
    setEndTime(toLocalDateTimeInputValue(new Date(start.getTime() + durationMs)));
  }

  function onEndChange(nextEnd: string) {
    setEndTime(nextEnd);
    const start = parseDatetimeLocalAsSgt(startTime);
    const end = parseDatetimeLocalAsSgt(nextEnd);
    if (!start || !end) return;
    const nextDuration = end.getTime() - start.getTime();
    if (nextDuration > 0) setDurationMs(nextDuration);
  }

  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Start <span className="font-normal text-stone-400">(SGT)</span></span>
        <input
          name="start_time"
          type="datetime-local"
          required
          className={ui.input}
          value={startTime}
          onChange={(event) => onStartChange(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>End <span className="font-normal text-stone-400">(SGT)</span></span>
        <input
          name="end_time"
          type="datetime-local"
          required
          className={ui.input}
          value={endTime}
          onChange={(event) => onEndChange(event.target.value)}
        />
        <p className={`text-xs ${ui.muted}`}>Moves with start unless you change it.</p>
      </label>
    </>
  );
}
