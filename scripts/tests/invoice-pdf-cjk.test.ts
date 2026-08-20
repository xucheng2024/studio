import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement as h } from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY, registerPdfFonts } from "../../src/lib/pdf-fonts.ts";

function pdfText(buffer: Uint8Array) {
  return Buffer.from(buffer).toString("latin1");
}

async function renderCjkPdf(lines: string[]) {
  registerPdfFonts();
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "A4", style: { fontFamily: PDF_FONT_FAMILY, fontSize: 12, padding: 24 } },
        ...lines.map((line) => h(Text, null, line)),
      ),
    ),
  );
}

test("PDF fonts render Chinese names without Helvetica substitution", async () => {
  const buffer = await renderCjkPdf(["刘Yongyan Liu", "Service: 咨询服务 × 1"]);
  const text = pdfText(buffer);
  assert.equal(text.slice(0, 5), "%PDF-");
  assert.match(text, /NotoSans/);
  assert.match(text, /NotoSansSC/);
  assert.doesNotMatch(text, /\/BaseFont\s*\/Helvetica/);
});

test("invoice and payslip PDFs register the CJK font family", () => {
  const invoiceSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/invoice-pdf.tsx"), "utf8");
  const payslipSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/payslip-pdf.tsx"), "utf8");
  for (const src of [invoiceSrc, payslipSrc]) {
    assert.match(src, /registerPdfFonts\(/);
    assert.match(src, /PDF_FONT_FAMILY/);
    assert.doesNotMatch(src, /Helvetica/);
  }
});
