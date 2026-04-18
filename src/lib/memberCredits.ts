/** Same rules as RPC create_member_booking_auto for eligibility display. */

export type MemberPackageForCredits = {
  id: string;
  /** Set when listing rows from client_packages (e.g. dashboard). */
  client_id?: string;
  credits_left: number;
  expiry_date: string | null;
  /** From packages.studio_id */
  studio_id: string;
  /** From packages.location_id */
  location_id: string | null;
  name: string;
};

export type SessionCreditContext = {
  studio_id: string;
  location_id: string | null;
  credits_required: number;
};

export function isPackageEligibleForSession(
  pack: MemberPackageForCredits,
  session: SessionCreditContext,
): boolean {
  if (pack.studio_id !== session.studio_id) return false;
  if (pack.location_id != null && pack.location_id !== session.location_id) return false;
  if (pack.expiry_date) {
    const exp = new Date(pack.expiry_date);
    if (exp.getTime() <= Date.now()) return false;
  }
  if (pack.credits_left <= 0) return false;
  if (pack.credits_left < session.credits_required) return false;
  return true;
}

export function sumEligibleCreditsForSession(
  packs: MemberPackageForCredits[],
  session: SessionCreditContext,
): number {
  return packs
    .filter((p) => isPackageEligibleForSession(p, session))
    .reduce((a, p) => a + p.credits_left, 0);
}

export function hasEligiblePackageForSession(
  packs: MemberPackageForCredits[],
  session: SessionCreditContext,
): boolean {
  return packs.some((p) => isPackageEligibleForSession(p, session));
}

/** Credits usable at any location in the studio (not expired, balance > 0). */
export function sumCreditsInStudio(packs: MemberPackageForCredits[], studioId: string): number {
  const now = Date.now();
  return packs
    .filter((p) => {
      if (p.studio_id !== studioId) return false;
      if (p.credits_left <= 0) return false;
      if (p.expiry_date && new Date(p.expiry_date).getTime() <= now) return false;
      return true;
    })
    .reduce((a, p) => a + p.credits_left, 0);
}

/** Global header: all non-expired balances with credits_left > 0 (any studio). */
export function sumAllSpendableCredits(packs: MemberPackageForCredits[]): number {
  const now = Date.now();
  return packs
    .filter((p) => {
      if (p.credits_left <= 0) return false;
      if (p.expiry_date && new Date(p.expiry_date).getTime() <= now) return false;
      return true;
    })
    .reduce((a, p) => a + p.credits_left, 0);
}

export function filterPacksForDashboard(
  packs: MemberPackageForCredits[],
  studioIds: string[],
  selectedLocationId: string | null,
): MemberPackageForCredits[] {
  const now = Date.now();
  return packs.filter((p) => {
    if (!studioIds.includes(p.studio_id)) return false;
    if (p.credits_left <= 0) return false;
    if (p.expiry_date && new Date(p.expiry_date).getTime() <= now) return false;
    if (selectedLocationId && p.location_id != null && p.location_id !== selectedLocationId) {
      return false;
    }
    return true;
  });
}

export function nearestExpiryDate(packs: MemberPackageForCredits[]): string | null {
  const dated = packs
    .map((p) => p.expiry_date)
    .filter((d): d is string => d != null && d.length > 0)
    .map((d) => new Date(d).getTime())
    .filter((t) => t > Date.now());
  if (dated.length === 0) return null;
  return new Date(Math.min(...dated)).toISOString();
}
