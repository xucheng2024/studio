import { ui } from "@/lib/ui";

const FORMATS = ["csv", "tsv", "xlsx", "xml"] as const;

export function ExportFormatLinks({ baseHref }: { baseHref: string }) {
  const join = baseHref.includes("?") ? "&" : "?";
  return (
    <div className="flex flex-wrap gap-2">
      {FORMATS.map((format) => (
        <a key={format} className={ui.btnSecondarySm} href={`${baseHref}${join}format=${format}`}>
          {format.toUpperCase()}
        </a>
      ))}
    </div>
  );
}
