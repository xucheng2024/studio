import sharp from "sharp";

export async function normalizeCoverImage(input: Buffer, sourceMime: string): Promise<{ buffer: Buffer; mime: string; ext: "jpg" | "webp" }> {
  const keepAlpha = sourceMime === "image/png" || sourceMime === "image/webp";
  const mime = keepAlpha ? "image/webp" : "image/jpeg";
  const ext = keepAlpha ? "webp" : "jpg";

  const pipeline = sharp(input, { failOn: "none" })
    .rotate()
    .resize(1200, 675, { fit: "cover", position: "centre" });

  const buffer = mime === "image/webp"
    ? await pipeline.webp({ quality: 85 }).toBuffer()
    : await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();

  return { buffer, mime, ext };
}
