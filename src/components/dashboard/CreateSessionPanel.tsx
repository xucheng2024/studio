"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createSessionWithTemplate } from "@/app/(app)/dashboard/actions";
import type { SessionPanelResult } from "@/app/(app)/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { WeekdayPicker } from "@/components/ui/WeekdayPicker";
import { ui } from "@/lib/ui";
import { CalendarPlus, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from "lucide-react";

type ClassOption = {
  id: string;
  title: string;
  capacity: number;
  duration_min: number;
  location_id: string | null;
};

type LocationOption = { id: string; name: string };

type Props = {
  classes: ClassOption[];
  locations: LocationOption[];
  activeStudioId: string;
  selectedLocationId: string | null;
  canManage: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDefaultDatetime(): string {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next.getTime() - now.getTime() < 30 * 60 * 1000) next.setHours(next.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:00`;
}

function estimateWeeklyCount(weekdays: string, startDate: string, endDate: string): number {
  if (!startDate || !weekdays) return 0;
  const days = weekdays.split(",").map((s) => s.trim()).filter(Boolean);
  if (!days.length) return 0;
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const targetDays = days.map((d) => map[d]).filter((d) => d != null);
  const start = new Date(startDate);
  const horizonEndExclusive = new Date(startDate);
  horizonEndExclusive.setDate(horizonEndExclusive.getDate() + 56);
  const hardEndExclusive = endDate ? new Date(endDate) : horizonEndExclusive;
  if (endDate) {
    hardEndExclusive.setDate(hardEndExclusive.getDate() + 1);
  }
  const endExclusive = hardEndExclusive < horizonEndExclusive ? hardEndExclusive : horizonEndExclusive;
  let count = 0;
  const d = new Date(start);
  while (d < endExclusive) {
    if (targetDays.includes(d.getDay())) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function formatWeekdays(weekdays: string): string {
  const labels: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  return weekdays.split(",").map((d) => labels[d.trim()] ?? d).join("/");
}

function formatOncePreview(datetime: string): string {
  if (!datetime) return "";
  const d = new Date(datetime);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `on ${date} at ${time}`;
}

function nextClassId(classes: ClassOption[], canManage: boolean) {
  return classes.length > 0 ? classes[0].id : (canManage ? "new" : "");
}

function defaultLocationId(locations: LocationOption[], selectedLocationId: string | null) {
  if (selectedLocationId) return selectedLocationId;
  return locations.length === 1 ? locations[0].id : "";
}

const LS_KEY = (studioId: string) => `studio-session-panel:${studioId}`;

type Persisted = {
  classId?: string;
  locationId?: string;
  guestPrice?: string;
  creditsRequired?: string;
  address?: string;
  addressDetails?: string;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function CreateSessionPanel({ classes, locations, activeStudioId, selectedLocationId, canManage }: Props) {
  const [open, setOpen] = useState(true);
  const defaultClassId = nextClassId(classes, canManage);
  const [classId, setClassId] = useState(defaultClassId);
  const [sessionType, setSessionType] = useState<"once" | "weekly">("once");
  const [locationId, setLocationId] = useState(() => defaultLocationId(locations, selectedLocationId));

  // Controlled fields for persistence + preview
  const defaultDatetime = useMemo(getDefaultDatetime, []);
  const [guestPrice, setGuestPrice] = useState("25");
  const [creditsRequired, setCreditsRequired] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetails, setAddressDetails] = useState("");

  // Preview tracking
  const [startDatetime, setStartDatetime] = useState(defaultDatetime);
  const [weekdays, setWeekdays] = useState("mon,wed");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newClassDuration, setNewClassDuration] = useState("60");
  const [newClassCapacity, setNewClassCapacity] = useState("10");
  const [onceDuration, setOnceDuration] = useState("60");
  const [onceCapacity, setOnceCapacity] = useState("10");

  const [state, formAction] = useActionState<SessionPanelResult | null, FormData>(
    createSessionWithTemplate,
    null,
  );

  const isNew = classId === "new";
  const selectedClass = classes.find((c) => c.id === classId) ?? null;
  const hasLocation = Boolean(locationId);
  const classTitle = isNew ? newClassName : (selectedClass?.title ?? "");

  // Load persisted values on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY(activeStudioId));
      if (!raw) return;
      const saved: Persisted = JSON.parse(raw);
      if (saved.classId && (classes.some((c) => c.id === saved.classId) || saved.classId === "new")) {
        setClassId(saved.classId);
      }
      if (saved.locationId && locations.some((location) => location.id === saved.locationId)) {
        setLocationId(saved.locationId);
      }
      if (saved.guestPrice !== undefined) setGuestPrice(saved.guestPrice);
      if (saved.creditsRequired !== undefined) setCreditsRequired(saved.creditsRequired);
      if (saved.address !== undefined) setAddress(saved.address);
      if (saved.addressDetails !== undefined) setAddressDetails(saved.addressDetails);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedLocationId && selectedLocationId !== locationId) {
      setLocationId(selectedLocationId);
    }
  }, [selectedLocationId, locationId]);

  useEffect(() => {
    if (isNew) {
      setOnceDuration(newClassDuration);
      setOnceCapacity(newClassCapacity);
      return;
    }
    if (selectedClass) {
      setOnceDuration(String(selectedClass.duration_min));
      setOnceCapacity(String(selectedClass.capacity));
      if (!locationId && selectedClass.location_id) {
        setLocationId(selectedClass.location_id);
      }
    }
  }, [classId, isNew, locationId, newClassCapacity, newClassDuration, selectedClass]);

  // On success: persist values + auto-collapse after delay
  const prevStateRef = useRef(state);
  useEffect(() => {
    if (!state?.ok || state === prevStateRef.current) return;
    prevStateRef.current = state;
    try {
      localStorage.setItem(LS_KEY(activeStudioId), JSON.stringify({
        classId, locationId, guestPrice, creditsRequired, address, addressDetails,
      }));
    } catch {}
    setClassId(nextClassId(classes, canManage));
    setLocationId(defaultLocationId(locations, selectedLocationId));
    setSessionType("once");
    setGuestPrice("25");
    setCreditsRequired("");
    setAddress("");
    setAddressDetails("");
    setStartDatetime(defaultDatetime);
    setWeekdays("mon,wed");
    setStartDate("");
    setEndDate("");
    setNewClassName("");
    setNewClassDuration("60");
    setNewClassCapacity("10");
    setOnceDuration("60");
    setOnceCapacity("10");
    const t = setTimeout(() => setOpen(false), 2500);
    return () => clearTimeout(t);
  }, [state, activeStudioId, address, addressDetails, canManage, classId, classes, creditsRequired, defaultDatetime, guestPrice, locationId, locations, selectedLocationId]);

  // NL preview
  const previewLine = useMemo(() => {
    const label = classTitle || (isNew ? "new class" : "");
    if (sessionType === "once") {
      const when = formatOncePreview(startDatetime);
      return label && when ? `1 ${label} session ${when}` : "";
    }
    const count = estimateWeeklyCount(weekdays, startDate, endDate);
    const days = weekdays ? formatWeekdays(weekdays) : "";
    if (!label || !count || !days) return "";
    return `~${count} ${label} session${count !== 1 ? "s" : ""} every ${days} starting ${startDate}${endDate ? ` through ${endDate}` : ""}`;
  }, [classTitle, endDate, isNew, sessionType, startDate, startDatetime, weekdays]);

  return (
    <div className={`${ui.card} max-w-xl`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-base font-semibold text-stone-900 dark:text-stone-100"
      >
        <span className="inline-flex items-center gap-2">
          <CalendarPlus size={17} />
          Create session
        </span>
        {open
          ? <ChevronUp size={16} className="text-stone-400" />
          : <ChevronDown size={16} className="text-stone-400" />}
      </button>

      {open && classes.length === 0 && !canManage && (
        <p className={`mt-4 text-sm ${ui.muted}`}>
          No class templates available. Ask an owner or manager to create one first.
        </p>
      )}

      {open && (classes.length > 0 || canManage) && (
        <form action={formAction} className="mt-5 flex flex-col gap-4">
          <input type="hidden" name="studio_id" value={activeStudioId} />
          <input type="hidden" name="session_type" value={sessionType} />

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Location</span>
            <select
              name="location_id"
              className={ui.select}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            {sessionType === "weekly" ? (
              <p className={`text-xs ${ui.muted}`}>Recurring schedules require a location.</p>
            ) : null}
          </label>

          {/* Class selector */}
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Class</span>
            <select
              name="class_id"
              required
              className={ui.select}
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                if (e.target.value !== "new") setNewClassName("");
              }}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
              {canManage && <option value="new">+ New class</option>}
            </select>
          </label>

          {/* Inline new class */}
          {isNew && canManage && (
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-stone-300 p-3 dark:border-stone-700">
              <p className={`text-xs font-medium ${ui.muted}`}>New class</p>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Class name</span>
                <input
                  name="new_class_title"
                  required
                  autoFocus
                  className={ui.input}
                  placeholder="e.g. Morning Yoga"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Duration (min)</span>
                  <input
                    name="new_class_duration_min"
                    type="number"
                    min={15}
                    step={5}
                    className={ui.input}
                    value={newClassDuration}
                    onChange={(e) => setNewClassDuration(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Capacity</span>
                  <input
                    name="new_class_capacity"
                    type="number"
                    min={1}
                    className={ui.input}
                    value={newClassCapacity}
                    onChange={(e) => setNewClassCapacity(e.target.value)}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Description</span>
                <textarea name="new_class_description" rows={2} className={`${ui.input} min-h-16`} placeholder="Optional" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Tags</span>
                <textarea
                  name="new_class_tags_input"
                  rows={2}
                  className={`${ui.input} min-h-16`}
                  placeholder={"Small group\nOpen level"}
                />
                <p className={`text-xs ${ui.muted}`}>One tag per line.</p>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Cover image URL</span>
                <input name="new_class_image_url" type="url" className={ui.input} placeholder="https://… (optional)" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Video URL</span>
                <input name="new_class_video_url" type="url" className={ui.input} placeholder="YouTube / Vimeo link (optional)" />
              </label>
            </div>
          )}

          {/* Session type toggle */}
          <div className="flex flex-col gap-1.5">
            <span className={ui.label}>Schedule type</span>
            {canManage && !hasLocation && (
              <p className={`text-xs ${ui.muted}`}>Choose a location above to enable weekly recurring.</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSessionType("once")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-medium transition ${
                  sessionType === "once"
                    ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-700"
                    : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
                }`}
              >
                <CalendarPlus size={14} />
                Single session
              </button>
              {canManage && (
                <button
                  type="button"
                  disabled={!hasLocation}
                  onClick={() => hasLocation && setSessionType("weekly")}
                  title={!hasLocation ? "Select a location first to create recurring sessions" : undefined}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-medium transition ${
                    !hasLocation
                      ? "cursor-not-allowed border-stone-200 bg-stone-50 text-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-600"
                      : sessionType === "weekly"
                        ? "border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-700"
                        : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
                  }`}
                >
                  <RefreshCw size={14} />
                  Repeat weekly
                </button>
              )}
            </div>
            {sessionType === "weekly" && (
              <p className={`text-xs ${ui.muted}`}>Creates the next 8 weeks of sessions.</p>
            )}
          </div>

          {/* One-time fields */}
          {sessionType === "once" && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Start</span>
                <input
                  type="datetime-local"
                  name="start_time"
                  required
                  className={ui.input}
                  value={startDatetime}
                  onChange={(e) => setStartDatetime(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Duration (min)</span>
                  <input
                    type="number"
                    name="duration_min"
                    min={15}
                    step={5}
                    className={ui.input}
                    value={onceDuration}
                    onChange={(e) => setOnceDuration(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Capacity</span>
                  <input
                    type="number"
                    name="capacity"
                    min={1}
                    className={ui.input}
                    value={onceCapacity}
                    onChange={(e) => setOnceCapacity(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          {/* Recurring fields */}
          {sessionType === "weekly" && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className={ui.label}>Weekdays</span>
                <WeekdayPicker name="by_weekday" defaultValue="mon,wed" onChange={setWeekdays} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Start date</span>
                  <input
                    type="date"
                    name="start_date"
                    required
                    className={ui.input}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>End date (optional)</span>
                  <input
                    type="date"
                    name="end_date"
                    className={ui.input}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Start time</span>
                  <input type="time" name="start_time" required className={ui.input} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ui.label}>Duration (min)</span>
                  <input type="number" name="duration_min" defaultValue={60} min={15} className={ui.input} />
                </label>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className={ui.label}>Capacity</span>
                <input type="number" name="capacity" defaultValue={10} min={1} className={ui.input} />
              </label>
            </>
          )}

          {/* Pricing — shared, controlled for persistence */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Guest price (SGD)</span>
              <input
                name="guest_price"
                type="number"
                min={0}
                step="0.01"
                className={ui.input}
                value={guestPrice}
                onChange={(e) => setGuestPrice(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ui.label}>Passes required <span className="font-normal text-stone-400">(optional)</span></span>
              <input
                name="credits_required"
                type="number"
                min={1}
                step="1"
                placeholder="Leave blank to disable"
                className={ui.input}
                value={creditsRequired}
                onChange={(e) => setCreditsRequired(e.target.value)}
              />
            </label>
          </div>

          {/* Address — shared, controlled for persistence */}
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Session address</span>
            <input
              name="address"
              className={ui.input}
              placeholder="Street address (optional)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Venue details</span>
            <textarea
              name="address_details"
              rows={2}
              className={`${ui.input} min-h-16`}
              placeholder="Floor, room, instructions (optional)"
              value={addressDetails}
              onChange={(e) => setAddressDetails(e.target.value)}
            />
          </label>

          {/* NL preview */}
          {previewLine && (
            <p className={`text-xs ${ui.muted} italic`}>{previewLine}</p>
          )}

          {/* Feedback strip */}
          {state?.ok === true && (
            <div className="flex items-center gap-2 rounded-xl bg-teal-50 px-3 py-2.5 text-sm font-medium text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
              <CheckCircle2 size={15} />
              {state.message}
            </div>
          )}
          {state?.ok === false && state.message && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400">
              <AlertCircle size={15} />
              {state.message}
            </div>
          )}

          <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Creating...">
            {sessionType === "weekly" ? "Create recurring schedule" : "Create session"}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
