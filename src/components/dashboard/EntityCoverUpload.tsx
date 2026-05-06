"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { COVER_MAX_BYTES } from "@/lib/coverMedia";
import { ui } from "@/lib/ui";

/**
 * Resize + compress an image file using an off-screen canvas.
 * - Caps longest edge at maxDim (default 1600px) while preserving aspect ratio.
 * - Outputs JPEG at `quality` (0–1). PNG/WebP with transparency fall back to
 *   WebP so the alpha channel is preserved.
 * - Returns the compressed Blob; falls back to the original File on any error.
 */
async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      const cw = Math.round(width * scale);
      const ch = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, cw, ch);
      const outMime = file.type === "image/png" || file.type === "image/webp" ? "image/webp" : "image/jpeg";
      canvas.toBlob((blob) => resolve(blob ?? file), outMime, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Props = {
  entity: "class" | "package";
  entityId: string;
  imageUrl: string | null;
  canEdit: boolean;
  /** "full" = aspect-video full-width (default). "thumb" = compact square thumbnail. */
  size?: "full" | "thumb";
};

export function EntityCoverUpload({ entity, entityId, imageUrl: initialUrl, canEdit, size = "full" }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => { setImageUrl(initialUrl); }, [initialUrl]);

  const apiBase = entity === "class"
    ? `/api/dashboard/classes/${entityId}/image`
    : `/api/dashboard/packages/${entityId}/image`;

  const processFile = async (file: File) => {
    setError(null);
    if (file.size > COVER_MAX_BYTES) { setError("Image must be 5MB or smaller."); return; }
    if (!ACCEPTED_TYPES.includes(file.type)) { setError("Use JPG, PNG, or WebP."); return; }
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const uploadFile = compressed.size < file.size ? compressed : file;
      const fd = new FormData();
      fd.set("file", uploadFile instanceof File ? uploadFile : new File([uploadFile], file.name, { type: uploadFile.type }));
      const res = await fetch(apiBase, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error === "file_too_large" ? "Image must be 5MB or smaller." : (body.error ?? "Upload failed")); return; }
      if (body.image_url) setImageUrl(body.image_url);
      toast.success("Cover image updated");
      router.refresh();
    } catch { setError("Network error. Please try again."); }
    finally { setBusy(false); }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void processFile(file);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.items?.[0]?.kind === "file") setDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void processFile(file);
  };

  const onRemove = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(apiBase, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? "Remove failed"); return; }
      setImageUrl(null);
      toast.success("Cover image removed");
      router.refresh();
    } catch { setError("Network error. Please try again."); }
    finally { setBusy(false); }
  };

  // Read-only preview for non-editors
  if (!canEdit) {
    if (!imageUrl) return null;
    if (size === "thumb") {
      return (
        <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900 sm:size-[72px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
        <div className="aspect-video w-full bg-stone-100 dark:bg-stone-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="size-full object-cover" loading="lazy" />
        </div>
      </div>
    );
  }

  const dragHandlers = { onDragEnter, onDragLeave, onDragOver, onDrop };

  // ── Compact thumbnail mode ──────────────────────────────────────────
  if (size === "thumb") {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={busy}
          aria-label={imageUrl ? "Replace cover image" : "Upload cover image"}
          className={`group relative size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors sm:size-[72px] ${
            dragging
              ? "border-teal-400 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/20"
              : imageUrl
              ? "border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900"
              : "border-dashed border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/30 dark:hover:border-stone-600"
          }`}
          onClick={() => !busy && inputRef.current?.click()}
          {...dragHandlers}
        >
          {imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                className={`size-full object-cover transition-opacity ${dragging ? "opacity-40" : "group-hover:opacity-60"}`}
                loading="lazy"
              />
              <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                {busy
                  ? <Loader2 size={14} className="animate-spin text-white drop-shadow" />
                  : <Upload size={14} className="text-white drop-shadow" />}
              </div>
            </>
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1">
              {busy
                ? <Loader2 size={18} className="animate-spin text-stone-400" />
                : <ImageIcon size={18} className="text-stone-400" />}
            </div>
          )}
        </button>
        {imageUrl ? (
          <button
            type="button"
            disabled={busy}
            className="text-[10px] leading-none text-red-500 hover:text-red-700 dark:text-red-400 disabled:opacity-50"
            onClick={() => void onRemove()}
          >
            Remove
          </button>
        ) : null}
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPickFile} />
        {error ? (
          <p className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
            <AlertCircle size={10} />{error}
          </p>
        ) : null}
      </div>
    );
  }

  // ── Full (default) mode ─────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {imageUrl ? (
        /* Has cover: show image; drag or click to replace */
        <button
          type="button"
          disabled={busy}
          aria-label="Replace cover image"
          className={`group relative w-full overflow-hidden rounded-xl border-2 bg-stone-100 transition-colors dark:bg-stone-900 ${
            dragging
              ? "border-teal-400 dark:border-teal-500"
              : "border-stone-200 dark:border-stone-700"
          }`}
          onClick={() => !busy && inputRef.current?.click()}
          {...dragHandlers}
        >
          <div className="aspect-video w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              className={`size-full object-cover transition-opacity ${dragging ? "opacity-40" : "group-hover:opacity-80"}`}
              loading="lazy"
            />
          </div>
          <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {busy ? "Uploading…" : dragging ? "Drop to replace" : "Replace"}
            </span>
          </div>
        </button>
      ) : (
        /* No cover: dashed drop zone */
        <button
          type="button"
          disabled={busy}
          aria-label="Upload cover image"
          className={`flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors disabled:opacity-50 ${
            dragging
              ? "border-teal-400 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/20"
              : "border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900/30 dark:hover:border-stone-600"
          }`}
          onClick={() => inputRef.current?.click()}
          {...dragHandlers}
        >
          {busy ? (
            <Loader2 size={24} className="animate-spin text-stone-400" />
          ) : dragging ? (
            <Upload size={24} className="text-teal-500" />
          ) : (
            <ImageIcon size={24} className="text-stone-400" />
          )}
          <span className={`text-sm font-medium ${dragging ? "text-teal-600 dark:text-teal-400" : ui.muted}`}>
            {busy ? "Uploading…" : dragging ? "Drop image here" : "Click or drag image here"}
          </span>
          {!busy && !dragging && (
            <span className={`text-xs ${ui.muted}`}>JPG, PNG or WebP · max 5MB</span>
          )}
        </button>
      )}

      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPickFile} />

      {imageUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className={`${ui.btnSecondarySm} disabled:opacity-50`}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={13} />
            Replace cover
          </button>
          <button
            type="button"
            disabled={busy}
            className={`${ui.btnSecondarySm} border-red-200 text-red-700 dark:border-red-800 dark:text-red-300 disabled:opacity-50`}
            onClick={() => void onRemove()}
          >
            <Trash2 size={13} />
            Remove
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle size={12} />{error}
        </p>
      ) : null}
    </div>
  );
}
