"use client";

import { useEffect, useTransition, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { PublicVideoCover } from "@/components/PublicVideoCover";
import { PublicMediaUploader } from "@/components/dashboard/PublicMediaUploader";
import { getVideoPreview } from "@/lib/videoPreview";
import { ui } from "@/lib/ui";

type CoverFieldProps = {
  studioId: string;
  entityId: string;
  folder: "studios" | "services" | "classes" | "packages" | "events" | "member-zone" | "shop";
  name: string;
  label: string;
  defaultValue: string | null;
  cropAspect?: number;
  /** When provided, the URL is saved to the DB immediately after upload (no separate Save click needed). */
  autoSaveAction?: (url: string | null) => Promise<void>;
};

export function CoverUrlField({ studioId, entityId, folder, name, label, defaultValue, cropAspect, autoSaveAction }: CoverFieldProps) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const isLogoField = cropAspect === 1;

  useEffect(() => {
    setValue(defaultValue ?? "");
  }, [studioId, entityId, defaultValue]);

  const handleUploaded = (url: string) => {
    setValue(url);
    if (!autoSaveAction) return;
    setSaving(true);
    startTransition(() => {
      void autoSaveAction(url).then(() => {
        setSaving(false);
        toast.success("Logo saved");
      }).catch(() => {
        setSaving(false);
        toast.error("Failed to save logo. Please click Save.");
      });
    });
  };

  const handleRemove = () => {
    setValue("");
    if (!autoSaveAction) return;
    setSaving(true);
    startTransition(() => {
      void autoSaveAction(null).then(() => {
        setSaving(false);
      }).catch(() => {
        setSaving(false);
      });
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className={ui.label}>{label}</span>
      <input type="hidden" name={name} value={value} />
      <PublicMediaUploader
        studioId={studioId}
        folder={folder}
        entityId={entityId}
        label={saving ? "Saving…" : value ? "Replace image" : "Upload image"}
        onUploaded={handleUploaded}
        cropAspect={cropAspect}
      />
      {value ? (
        <div className="mt-1 space-y-2">
          <div
            className={cropAspect === 1
              ? "relative h-28 w-28 overflow-hidden rounded-lg border border-stone-200 bg-[linear-gradient(45deg,#f5f5f4_25%,transparent_25%),linear-gradient(-45deg,#f5f5f4_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f5f5f4_75%),linear-gradient(-45deg,transparent_75%,#f5f5f4_75%)] bg-size-[12px_12px] bg-position-[0_0,0_6px,6px_-6px,-6px_0] dark:border-stone-700 dark:bg-[linear-gradient(45deg,#1c1917_25%,transparent_25%),linear-gradient(-45deg,#1c1917_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1c1917_75%),linear-gradient(-45deg,transparent_75%,#1c1917_75%)]"
              : "relative h-28 w-full overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700"
            }
          >
            {isLogoField ? (
              // Keep dashboard logo preview resilient for freshly uploaded remote URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value}
                alt=""
                className="h-full w-full object-contain object-center"
              />
            ) : (
              <Image
                src={value}
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 640px"
              />
            )}
          </div>
          <button type="button" className={ui.btnGhost} onClick={handleRemove} disabled={saving}>
            Remove image
          </button>
        </div>
      ) : null}
    </div>
  );
}

type StudioProfileMediaFieldsProps = {
  studioId: string;
  coverDefaultValue: string | null;
  videoDefaultValue: string | null;
  studioName: string;
};

export function StudioProfileMediaFields({
  studioId,
  coverDefaultValue,
  videoDefaultValue,
  studioName,
}: StudioProfileMediaFieldsProps) {
  const [coverValue, setCoverValue] = useState(coverDefaultValue ?? "");
  const [videoValue, setVideoValue] = useState(videoDefaultValue ?? "");

  useEffect(() => {
    setCoverValue(coverDefaultValue ?? "");
    setVideoValue(videoDefaultValue ?? "");
  }, [studioId, coverDefaultValue, videoDefaultValue]);

  const videoPreview = getVideoPreview(videoValue);
  const previewCover = coverValue || videoPreview.thumbnailUrl || null;

  return (
    <div className="grid gap-4 rounded-xl border border-stone-200 p-4 dark:border-stone-700">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Profile media</h2>
        <p className={`text-xs ${ui.muted}`}>
          Cover image and promo video now share one display area. Visitors will see the cover first and play the video from there.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
        <div className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={ui.label}>Cover image</span>
            <p className={`text-xs ${ui.muted}`}>Shown by default before the video is played.</p>
            <input type="hidden" name="public_cover_image_url" value={coverValue} />
            <PublicMediaUploader
              studioId={studioId}
              folder="studios"
              entityId="cover"
              label={coverValue ? "Replace image" : "Upload image"}
              onUploaded={(url) => setCoverValue(url)}
            />
            {coverValue ? (
              <div className="mt-1 space-y-2">
                <div className="relative h-28 w-full overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
                  <Image src={coverValue} alt="" fill className="object-cover" sizes="(max-width: 768px) 100vw, 640px" />
                </div>
                <button type="button" className={ui.btnGhost} onClick={() => setCoverValue("")}>
                  Remove image
                </button>
              </div>
            ) : null}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>Promo video URL</span>
            <p className={`text-xs ${ui.muted}`}>Paste a YouTube or Vimeo link to make the cover playable.</p>
            <input
              name="public_video_url"
              className={ui.input}
              value={videoValue}
              onChange={(event) => setVideoValue(event.target.value)}
              placeholder="https://..."
            />
          </label>
        </div>

        <div className="space-y-2">
          <span className={ui.label}>Preview</span>
          <PublicVideoCover
            title={studioName}
            coverUrl={previewCover}
            embedUrl={videoPreview.embedUrl}
            fallbackUrl={videoValue.trim() || null}
          />
        </div>
      </div>
    </div>
  );
}

type CoverVideoFieldsProps = {
  studioId: string;
  folder: "studios" | "services" | "classes" | "packages" | "events" | "member-zone" | "shop";
  /** A stable identifier for uploads (e.g. classId, packageId, "new-class"). */
  entityId: string;
  title: string;
  coverName: string;
  videoName: string;
  coverDefaultValue: string | null;
  videoDefaultValue: string | null;
  coverLabel?: string;
  videoLabel?: string;
};

/** Generic cover + video editor with preview (used by create/edit forms). */
export function CoverVideoFields({
  studioId,
  folder,
  entityId,
  title,
  coverName,
  videoName,
  coverDefaultValue,
  videoDefaultValue,
  coverLabel = "Cover image",
  videoLabel = "Video URL",
}: CoverVideoFieldsProps) {
  const [coverValue, setCoverValue] = useState(coverDefaultValue ?? "");
  const [videoValue, setVideoValue] = useState(videoDefaultValue ?? "");

  useEffect(() => {
    setCoverValue(coverDefaultValue ?? "");
    setVideoValue(videoDefaultValue ?? "");
  }, [studioId, entityId, coverDefaultValue, videoDefaultValue]);

  const videoPreview = getVideoPreview(videoValue);
  const previewCover = coverValue || videoPreview.thumbnailUrl || null;

  return (
    <div className="grid gap-4 rounded-xl border border-stone-200 p-4 dark:border-stone-700">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
        <div className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={ui.label}>{coverLabel}</span>
            <input type="hidden" name={coverName} value={coverValue} />
            <PublicMediaUploader
              studioId={studioId}
              folder={folder}
              entityId={entityId}
              label={coverValue ? "Replace image" : "Upload image"}
              onUploaded={(url) => setCoverValue(url)}
            />
            {coverValue ? (
              <div className="mt-1 space-y-2">
                <div className="relative h-28 w-full overflow-hidden rounded-lg border border-stone-200 dark:border-stone-700">
                  <Image src={coverValue} alt="" fill className="object-cover" sizes="(max-width: 768px) 100vw, 640px" />
                </div>
                <button type="button" className={ui.btnGhost} onClick={() => setCoverValue("")}>
                  Remove image
                </button>
              </div>
            ) : null}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={ui.label}>{videoLabel}</span>
            <input
              name={videoName}
              className={ui.input}
              value={videoValue}
              onChange={(event) => setVideoValue(event.target.value)}
              placeholder="https://..."
            />
          </label>
        </div>

        <div className="space-y-2">
          <span className={ui.label}>Preview</span>
          <PublicVideoCover
            title={title}
            coverUrl={previewCover}
            embedUrl={videoPreview.embedUrl}
            fallbackUrl={videoValue.trim() || null}
          />
        </div>
      </div>
    </div>
  );
}
