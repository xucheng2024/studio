"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, CheckCircle2, Copy, EyeOff, Play, Pencil, Trash2, AlertCircle } from "lucide-react";
import { ui } from "@/lib/ui";

type Loc = { id: string; name: string };
type Ins = { id: string; name: string };

export function ClassTemplateLifecycleRow({
  classId,
  studioPublicSlug,
  shareSlug,
  isActive,
  canEdit,
  canCopyLink,
  initial,
  locations,
  instructors,
}: {
  classId: string;
  studioPublicSlug: string | null;
  shareSlug: string | null;
  isActive: boolean;
  canEdit: boolean;
  canCopyLink: boolean;
  initial: {
    title: string;
    description: string | null;
    capacity: number;
    duration_min: number;
    instructor_id: string | null;
    location_id: string | null;
  };
  locations: Loc[];
  instructors: Ins[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [durationMin, setDurationMin] = useState(String(initial.duration_min));
  const [instructorId, setInstructorId] = useState(initial.instructor_id ?? "");
  const [locationId, setLocationId] = useState(initial.location_id ?? "");

  const copyBookingLink = async () => {
    setMsg(null);
    setBusy(true);
    const res = await fetch("/api/dashboard/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: "class", entity_id: classId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(body.error ?? "Could not build link");
      return;
    }
    if (body.url) {
      await navigator.clipboard.writeText(body.url);
      setMsg("Copied booking link");
    }
  };

  const save = async () => {
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/dashboard/classes/${classId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description.trim() === "" ? null : description,
        capacity: Number(capacity),
        duration_min: Number(durationMin),
        instructor_id: instructorId === "" ? null : instructorId,
        location_id: locationId === "" ? null : locationId,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error ?? "Save failed");
      return;
    }
    setMsg("Saved");
    router.refresh();
  };

  const hideTemplate = async () => {
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/dashboard/classes/${classId}/disable`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error ?? "Failed");
      return;
    }
    router.refresh();
  };

  const resume = async () => {
    setMsg(null);
    setBusy(true);
    const res = await fetch(`/api/dashboard/classes/${classId}/restore`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body.error ?? "Failed");
      return;
    }
    router.refresh();
  };

  const deleteTemplate = async () => {
    setMsg(null);
    if (!window.confirm("Delete this class template? This only works when no session has ever been created from it.")) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/dashboard/classes/${classId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      if (body.error === "class_has_sessions") {
        setMsg("This template already has sessions. Hide it instead.");
        return;
      }
      setMsg(body.error ?? "Failed");
      return;
    }
    setMsg("Deleted");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!isActive ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            Hidden
          </span>
        ) : null}
        {shareSlug && studioPublicSlug ? (
          <span className={`font-mono text-xs ${ui.muted}`}>
            /class/{studioPublicSlug}/{shareSlug}
          </span>
        ) : null}
      </div>

      {canCopyLink ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !studioPublicSlug}
            className={`${ui.btnSecondarySm} disabled:opacity-50`}
            onClick={() => void copyBookingLink()}
          >
            <Copy size={13} />
            Copy booking link
          </button>
        </div>
      ) : null}

      {canEdit ? (
        <details className="chevron rounded-lg border border-stone-200 p-3 dark:border-stone-700">
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-stone-800 dark:text-stone-200">
            <Pencil size={13} />
            Edit
          </summary>
          <div className="mt-3 grid max-w-lg gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={ui.label}>Title</span>
              <input className={ui.input} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={ui.label}>Description</span>
              <textarea
                className={`${ui.input} min-h-16`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Capacity</span>
              <input className={ui.input} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Duration (min)</span>
              <input className={ui.input} type="number" min={15} step={5} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={ui.label}>Instructor</span>
              <select className={ui.select} value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
                <option value="">—</option>
                {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={ui.label}>Location</span>
              <select className={ui.select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy} className={`${ui.btnPrimarySm} w-fit md:col-span-2`} onClick={() => void save()}>
              <Check size={13} />
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </details>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {isActive ? (
            <button
              type="button"
              disabled={busy}
              className={`${ui.btnSecondarySm} border-amber-300 text-amber-900 dark:border-amber-700 dark:text-amber-200`}
              onClick={() => void hideTemplate()}
            >
              <EyeOff size={13} />
              Hide
            </button>
          ) : (
            <button type="button" disabled={busy} className={ui.btnPrimarySm} onClick={() => void resume()}>
              <Play size={13} />
              Resume
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={`${ui.btnSecondarySm} border-red-300 text-red-700 dark:border-red-700 dark:text-red-300`}
            onClick={() => void deleteTemplate()}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      ) : null}

      {msg ? (
        <p className={`flex items-center gap-1.5 text-xs ${
          msg === "Saved" || msg === "Copied booking link"
            ? "text-teal-700 dark:text-teal-400"
            : "text-red-600 dark:text-red-400"
        }`}>
          {msg === "Saved" || msg === "Copied booking link"
            ? <CheckCircle2 size={12} />
            : <AlertCircle size={12} />}
          {msg}
        </p>
      ) : null}
    </div>
  );
}
