export const DEFAULT_PAYMENT_VERIFICATION_SLA_MIN = 30;

type SlaRuleRow = {
  studio_id: string;
  location_id: string | null;
  payment_verification_sla_min: number | null;
};

function clampSlaMinutes(raw: number | null | undefined) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PAYMENT_VERIFICATION_SLA_MIN;
  return Math.min(24 * 60, Math.max(1, Math.floor(n)));
}

export function resolvePaymentVerificationSlaMin(
  rules: SlaRuleRow[],
  studioId: string | null | undefined,
  locationId: string | null | undefined,
) {
  if (!studioId) return DEFAULT_PAYMENT_VERIFICATION_SLA_MIN;
  const scoped = rules.filter((r) => r.studio_id === studioId);
  if (!scoped.length) return DEFAULT_PAYMENT_VERIFICATION_SLA_MIN;
  if (locationId) {
    const locRule = scoped.find((r) => r.location_id === locationId);
    if (locRule) return clampSlaMinutes(locRule.payment_verification_sla_min);
  }
  const studioRule = scoped.find((r) => r.location_id == null);
  return clampSlaMinutes(studioRule?.payment_verification_sla_min);
}

