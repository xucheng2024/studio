"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Pencil, Trash2, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { EntityCoverUpload } from "@/components/dashboard/EntityCoverUpload";
import { formatPublicTagsInput, parsePublicTagsInput } from "@/lib/publicTags";
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
  coverImageUrl,
  tags,
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
  coverImageUrl: string | null;
  tags: string[] | null;
  initial: {
    title: string;
    description: string | null;
    tags: string[] | null;
    capacity: number;
    duration_min: number;
    instructor_id: string | null;
    location_id: string | null;
    video_url: string | null;
  };
  locations: Loc[];
  instructors: Ins[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [tagsInput, setTagsInput] = useState(formatPublicTagsInput(initial.tags));
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [durationMin, setDurationMin] = useState(String(initial.duration_min));
  const [instructorId, setInstructorId] = useState(initial.instructor_id ?? "");
  const [locationId, setLocationId] = useState(initial.location_id ?? "");
  const [videoUrl, setVideoUrl] = useState(initial.video_url ?? "");

  const copyBookingLink = async () => {
    setBusy(true);
    const res = await fetch("/api/dashboard/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_type: "class", entity_id: classId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not build link");
      return;
    }
    if (body.url) {
      try {
        await navigator.clipboard.writeText(body.url);
        toast.success("Detail link copied");
      } catch {
        toast.info(body.url);
      }
    }
  };

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/dashboard/classes/${classId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description.trim() === "" ? null : description,
        tags: parsePublicTagsInput(tagsInput),
        capacity: Number(capacity),
        duration_min: Number(durationMin),
        instructor_id: instructorId === "" ? null : instructorId,
        location_id: locationId === "" ? null : locationId,
        video_url: videoUrl.trim() === "" ? null : videoUrl.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Save failed");
      return;
    }
    toast.success("Changes saved");
    router.refresh();
  };

  const deleteTemplate = async () => {
    setBusy(true);
    setDeleteConfirm(false);
    const res = await fetch(`/api/dashboard/classes/${classId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Remove failed");
      return;
    }
    toast.success("Class template removed");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {/* ── Main row: thumbnail + info + actions ── */}
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        <EntityCoverUpload
          entityId={classId}
          imageUrl={coverImageUrl}
          canEdit={canEdit}
          size="thumb"
        />

        {/* Info + action buttons */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            {/* Title + meta */}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-medium text-stone-900 dark:text-stone-100">{initial.title}</p>
                {!isActive ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                    Hidden
                  </span>
                ) : null}
              </div>
              <p className={`mt-0.5 text-xs ${ui.muted}`}>
                cap {initial.capacity} · {initial.duration_min} min
                {initial.instructor_id && instructors.find((i) => i.id === initial.instructor_id)?.name
                  ? ` · ${instructors.find((i) => i.id === initial.instructor_id)!.name}`
                  : ""}
              </p>
              {shareSlug && studioPublicSlug ? (
                <p className={`mt-0.5 font-mono text-[11px] ${ui.muted}`}>
                  /{studioPublicSlug}/classes/{shareSlug}
                </p>
              ) : null}
              {tags && tags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {Array.from(
                    new Map(tags.map((t) => [String(t ?? "").toLowerCase(), String(t ?? "")])).values(),
                  )
                    .filter(Boolean)
                    .slice(0, 4)
                    .map((tag) => (
                      <span
                        key={`${classId}-${tag.toLowerCase()}`}
                        className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                      >
                        {tag}
                      </span>
                    ))}
                </div>
              ) : null}
            </div>

            {/* Action buttons */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {canCopyLink ? (
                <button
                  type="button"
                  disabled={busy || !studioPublicSlug}
                  className={`${ui.btnSecondarySm} disabled:opacity-50`}
                  onClick={() => void copyBookingLink()}
                >
                  <Copy size={12} />
                  <span className="hidden sm:inline">Copy link</span>
                </button>
              ) : null}

              {canEdit ? (
                <>
                  {deleteConfirm ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs dark:border-red-800/50 dark:bg-red-950/20">
                      <AlertTriangle size={11} className="shrink-0 text-red-600 dark:text-red-400" />
                      <button
                        type="button"
                        className="font-semibold text-red-700 hover:underline dark:text-red-400"
                        onClick={() => void deleteTemplate()}
                      >
                        Remove?
                      </button>
                      <button type="button" className="text-stone-400 hover:text-stone-600" onClick={() => setDeleteConfirm(false)}>
                        <X size={11} />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className={`${ui.btnSecondarySm} border-red-200 text-red-600 dark:border-red-800 dark:text-red-400 disabled:opacity-50`}
                      onClick={() => setDeleteConfirm(true)}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ── Edit panel ── */}
      {canEdit ? (
        <details className="chevron rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-700">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300">
            <Pencil size={12} />
            Edit template
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={ui.label}>Cover image</span>
              <div className="mt-2">
                <EntityCoverUpload
                  entityId={classId}
                  imageUrl={coverImageUrl}
                  canEdit={canEdit}
                  size="full"
                />
              </div>
            </div>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Title</span>
              <input className={ui.input} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Description</span>
              <textarea
                className={`${ui.input} min-h-16`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Promo video URL</span>
              <input
                className={ui.input}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={ui.label}>Tags <span className={`font-normal ${ui.muted}`}>(one per line)</span></span>
              <textarea
                className={`${ui.input} min-h-[4.5rem]`}
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
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
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Instructor</span>
              <select className={ui.select} value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
                <option value="">—</option>
                {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={ui.label}>Location</span>
              <select className={ui.select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy} className={`${ui.btnPrimarySm} w-fit sm:col-span-2`} onClick={() => void save()}>
              <Check size={12} />
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </details>
      ) : null}
    </div>
  );
}
