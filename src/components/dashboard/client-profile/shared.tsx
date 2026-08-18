export type ClientProfileScope = {
  studioId: string;
  customerId: string;
  locationId: string | null;
};

export function ScopeFields({ scope }: { scope: ClientProfileScope }) {
  return (
    <>
      <input type="hidden" name="studio_id" value={scope.studioId} />
      <input type="hidden" name="customer_id" value={scope.customerId} />
      {scope.locationId ? <input type="hidden" name="location_id" value={scope.locationId} /> : null}
    </>
  );
}

export function SaveBar({ children }: { children: React.ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}

export const profileListRow =
  "rounded-xl border border-stone-100 bg-white/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40";

export const paymentStatusColors: Record<string, string> = {
  paid: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/60",
  pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60",
  failed: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60",
  refunded: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700",
};

export function membershipStatusLabel(status: string | null | undefined) {
  if (status === "canceled") return "cancelled";
  return status ?? "scheduled";
}

export function latestConsent(
  consents: Array<{ consent_key: string; status: string; text_version: string; occurred_at: string }>,
  key: string,
) {
  return consents.find((event) => event.consent_key === key) ?? null;
}
