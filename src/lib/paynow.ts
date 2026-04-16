import QRCode from "qrcode";

const REF_PREFIX = "STU";
export type PaynowProxyType = "uen" | "mobile" | "uen_mobile";

export type PaynowConfig = {
  paynow_enabled: boolean;
  paynow_proxy_type: string | null;
  paynow_uen: string | null;
  paynow_mobile: string | null;
  paynow_payee_name: string | null;
};

export function generatePaynowReference() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${REF_PREFIX}-${ymd}-${rand}`;
}

export function buildPaynowPayload(params: {
  proxyType: PaynowProxyType;
  uen?: string | null;
  mobile?: string | null;
  payeeName?: string | null;
  amount: number;
  reference: string;
}) {
  const amount = Number(params.amount).toFixed(2);
  const ref = encodeURIComponent(params.reference);
  const payee = params.payeeName?.trim()
    ? `&name=${encodeURIComponent(params.payeeName.trim())}`
    : "";

  if (params.proxyType === "mobile") {
    return `PAYNOW://MOBILE/${encodeURIComponent(params.mobile ?? "")}?amount=${amount}&ref=${ref}${payee}`;
  }
  if (params.proxyType === "uen_mobile") {
    return `PAYNOW://UEN/${encodeURIComponent(params.uen ?? "")}?amount=${amount}&ref=${ref}&mobile=${encodeURIComponent(params.mobile ?? "")}${payee}`;
  }
  return `PAYNOW://UEN/${encodeURIComponent(params.uen ?? "")}?amount=${amount}&ref=${ref}${payee}`;
}

export function validatePaynowConfig(config: PaynowConfig): {
  ok: true;
  proxyType: PaynowProxyType;
  uen: string | null;
  mobile: string | null;
  payeeName: string | null;
} | {
  ok: false;
  error: "PAYNOW_NOT_CONFIGURED";
  message: string;
} {
  const enabled = Boolean(config.paynow_enabled);
  const proxyType = (config.paynow_proxy_type ?? "").trim() as PaynowProxyType;
  const uen = config.paynow_uen?.trim() || null;
  const mobile = config.paynow_mobile?.trim() || null;
  const payeeName = config.paynow_payee_name?.trim() || null;

  if (!enabled) {
    return { ok: false, error: "PAYNOW_NOT_CONFIGURED", message: "PayNow is disabled for this studio." };
  }
  if (!["uen", "mobile", "uen_mobile"].includes(proxyType)) {
    return { ok: false, error: "PAYNOW_NOT_CONFIGURED", message: "Proxy type is missing." };
  }
  if (proxyType === "uen" && !uen) {
    return { ok: false, error: "PAYNOW_NOT_CONFIGURED", message: "UEN is required." };
  }
  if (proxyType === "mobile" && !mobile) {
    return { ok: false, error: "PAYNOW_NOT_CONFIGURED", message: "Mobile number is required." };
  }
  if (proxyType === "uen_mobile" && (!uen || !mobile)) {
    return {
      ok: false,
      error: "PAYNOW_NOT_CONFIGURED",
      message: "Both UEN and mobile number are required.",
    };
  }
  return { ok: true, proxyType, uen, mobile, payeeName };
}

function maskTail(value: string | null, visible = 4) {
  if (!value) return "not set";
  if (value.length <= visible) return value;
  return `${"*".repeat(Math.max(0, value.length - visible))}${value.slice(-visible)}`;
}

export function getPaynowSummary(config: PaynowConfig) {
  const checked = validatePaynowConfig(config);
  if (!checked.ok) {
    return {
      configured: false,
      line: "This studio has not configured PayNow yet.",
    };
  }
  const account =
    checked.proxyType === "mobile"
      ? `Mobile ${maskTail(checked.mobile)}`
      : checked.proxyType === "uen_mobile"
        ? `UEN ${maskTail(checked.uen)} · Mobile ${maskTail(checked.mobile)}`
        : `UEN ${maskTail(checked.uen)}`;
  return {
    configured: true,
    line: `${checked.payeeName || "Payee"} · ${account}`,
  };
}

export async function toQrDataUrl(payload: string) {
  return QRCode.toDataURL(payload, {
    width: 520,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}
