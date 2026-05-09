"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { ui } from "@/lib/ui";
import "react-easy-crop/react-easy-crop.css";

type Props = {
  file: File;
  open: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

const OUT_W = 1200;
const OUT_H = 675;

async function exportCroppedImage(src: string, crop: Area, file: File): Promise<File> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("load_failed"));
    img.src = src;
  });

  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    OUT_W,
    OUT_H,
  );

  const outType = file.type === "image/png" || file.type === "image/webp" ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.9));
  if (!blob) throw new Error("encode_failed");
  return new File([blob], file.name, { type: outType });
}

export function ImageCropperDialog({ file, open, onCancel, onConfirm }: Props) {
  const src = useMemo(() => URL.createObjectURL(file), [file]);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCropPixels(areaPixels);
  }, []);

  const handleReset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(minZoom);
  };

  const handleConfirm = async () => {
    if (!cropPixels || busy) return;
    setBusy(true);
    try {
      const output = await exportCroppedImage(src, cropPixels, file);
      onConfirm(output);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white p-4 shadow-2xl dark:bg-stone-900">
        <div className="mb-2 text-sm font-semibold">Crop image (16:9)</div>
        <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-stone-300 bg-black" style={{ aspectRatio: "16 / 9" }}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            minZoom={minZoom}
            maxZoom={minZoom + 2}
            aspect={16 / 9}
            restrictPosition
            objectFit="contain"
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            onMediaLoaded={({ naturalWidth, naturalHeight }) => {
              const nextMinZoom = Math.max(OUT_W / naturalWidth, OUT_H / naturalHeight, 1);
              setMinZoom(nextMinZoom);
              setZoom(nextMinZoom);
              setCrop({ x: 0, y: 0 });
            }}
          />
        </div>
        <div className="mt-3 space-y-3">
          <label className="block text-xs text-stone-600 dark:text-stone-300">Zoom</label>
          <input
            type="range"
            min={minZoom}
            max={minZoom + 2}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={ui.btnSecondarySm} onClick={handleReset} disabled={busy}>Reset</button>
          <button type="button" className={ui.btnSecondarySm} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={ui.btnPrimarySm} onClick={() => void handleConfirm()} disabled={busy || !cropPixels}>Use this crop</button>
        </div>
      </div>
    </div>
  );
}
