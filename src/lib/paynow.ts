import QRCode from "qrcode";

const REF_PREFIX = "STU";

export function generatePaynowReference() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${REF_PREFIX}-${ymd}-${rand}`;
}

export function buildPaynowPayload(params: {
  studioCode: string;
  amount: number;
  reference: string;
}) {
  const amount = Number(params.amount).toFixed(2);
  return `PAYNOW://UEN/${encodeURIComponent(params.studioCode)}?amount=${amount}&ref=${encodeURIComponent(params.reference)}`;
}

export async function toQrDataUrl(payload: string) {
  return QRCode.toDataURL(payload, {
    width: 520,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}
