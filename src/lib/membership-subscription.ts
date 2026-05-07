type MembershipSubscriptionLike = {
  status?: string | null;
  cancel_at_period_end?: boolean | null;
  current_period_end?: string | null;
};

export function isMembershipEnded(
  subscription: MembershipSubscriptionLike,
  now = new Date(),
) {
  if (!subscription.cancel_at_period_end || !subscription.current_period_end) return false;
  return new Date(subscription.current_period_end).getTime() <= now.getTime();
}

export function getMembershipDisplayStatus(
  subscription: MembershipSubscriptionLike,
  now = new Date(),
) {
  if (isMembershipEnded(subscription, now)) return "canceled";
  if (subscription.cancel_at_period_end) return "ending";
  return subscription.status ?? "scheduled";
}

export function isMembershipActiveForAccess(
  subscription: MembershipSubscriptionLike,
  now = new Date(),
) {
  const status = String(subscription.status ?? "").toLowerCase();
  if (status === "canceled") return false;
  if (isMembershipEnded(subscription, now)) return false;
  return ["scheduled", "active", "retrying", "inactive", "paused"].includes(status);
}
