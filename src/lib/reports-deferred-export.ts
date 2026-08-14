export type DeferredExportFormat = "csv" | "tsv" | "xlsx" | "xml";

type DeferredExportPayload = {
  body: string | Uint8Array;
  contentType: string;
};

function escapeDelimited(value: unknown, delimiter: "," | "\t") {
  const text = String(value ?? "");
  const hasSpecial = delimiter === ","
    ? text.includes(",") || text.includes("\"") || text.includes("\n")
    : text.includes("\t") || text.includes("\"") || text.includes("\n");
  if (hasSpecial) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildXmlPayload(params: { headers: unknown[]; rows: unknown[][] }): DeferredExportPayload {
  const headerXml = params.headers.map((header) => `<column name="${escapeXml(header)}" />`).join("");
  const rowsXml = params.rows
    .map((row) => {
      const fields = row
        .map((value, index) => {
          const key = String(params.headers[index] ?? `col_${index + 1}`);
          return `<cell name="${escapeXml(key)}">${escapeXml(value)}</cell>`;
        })
        .join("");
      return `<row>${fields}</row>`;
    })
    .join("");

  return {
    body: `<?xml version="1.0" encoding="UTF-8"?><deferred_export><columns>${headerXml}</columns><rows>${rowsXml}</rows></deferred_export>`,
    contentType: "application/xml; charset=utf-8",
  };
}

async function buildXlsxPayload(params: { headers: unknown[]; rows: unknown[][] }): Promise<DeferredExportPayload> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([params.headers, ...params.rows]);
  xlsx.utils.book_append_sheet(workbook, worksheet, "Deferred Export");
  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return {
    body: new Uint8Array(buffer),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export async function buildDeferredExportPayload(params: {
  format: DeferredExportFormat;
  headers: unknown[];
  rows: unknown[][];
}): Promise<DeferredExportPayload> {
  if (params.format === "xlsx") {
    return buildXlsxPayload(params);
  }

  if (params.format === "xml") {
    return buildXmlPayload(params);
  }

  const delimiter = params.format === "tsv" ? "\t" : ",";
  const body = [params.headers, ...params.rows]
    .map((row) => row.map((value) => escapeDelimited(value, delimiter)).join(delimiter))
    .join("\n");

  const contentType = params.format === "tsv"
    ? "text/tab-separated-values; charset=utf-8"
    : "text/csv; charset=utf-8";

  return {
    body,
    contentType,
  };
}
