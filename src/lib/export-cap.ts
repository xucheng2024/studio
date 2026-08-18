export type ExportFormat = "csv" | "tsv" | "xlsx" | "xml";

export function parseExportFormat(value: string | null | undefined): ExportFormat {
  const requested = (value ?? "").toLowerCase();
  return requested === "tsv" || requested === "xlsx" || requested === "xml" ? requested : "csv";
}

export type ExportCapConfig = {
  heavyFormats?: ExportFormat[];
  standardCap?: number;
  heavyCap?: number;
};

export function resolveExportCap(format: ExportFormat, config?: ExportCapConfig) {
  const heavyFormats = config?.heavyFormats ?? ["xlsx", "xml"];
  const standardCap = config?.standardCap ?? 5000;
  const heavyCap = config?.heavyCap ?? 2000;
  const isHeavyFormat = heavyFormats.includes(format);

  return {
    isHeavyFormat,
    exportCap: isHeavyFormat ? heavyCap : standardCap,
  };
}

export function applyExportCap<T>(rows: T[], exportCap: number) {
  const wasCapped = rows.length > exportCap;
  const cappedRows = wasCapped ? rows.slice(0, exportCap) : rows;

  return {
    rows: cappedRows,
    wasCapped,
    exportCap,
    sourceRowCount: rows.length,
  };
}

export function buildExportCapHeaders(params: {
  wasCapped: boolean;
  exportCap: number;
  rowCount: number;
}) {
  return {
    "x-export-row-count": String(params.rowCount),
    "x-export-capped": String(params.wasCapped),
    "x-export-cap": String(params.exportCap),
    ...(params.wasCapped ? { "x-export-warning": `export capped at ${params.exportCap} source rows` } : {}),
  };
}

