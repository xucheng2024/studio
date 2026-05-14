type LocationJoinRow = { name?: string | null; address?: string | null };

/** Merge `events.address` / `address_details` with optional `locations ( name, address )` embed. */
export function eventVenueForPublicBlock(event: {
  address?: string | null;
  address_details?: string | null;
  locations?: LocationJoinRow | LocationJoinRow[] | null;
}): { address: string | null; addressDetails: string | null } {
  const loc = event.locations;
  const row = Array.isArray(loc) ? loc[0] : loc;
  const eAddr = String(event.address ?? "").trim();
  const eDet = String(event.address_details ?? "").trim();
  const lAddr = String(row?.address ?? "").trim();
  const lName = String(row?.name ?? "").trim();
  const primary = eAddr || lAddr || lName || "";
  const details =
    eDet ||
    (lName && primary && primary !== lName ? lName : "") ||
    "";
  return {
    address: primary || null,
    addressDetails: String(details).trim() || null,
  };
}

/** Venue block: label on first line, address (+ details) on second. */
export function PublicVenueBlock({
  address,
  addressDetails,
}: {
  address?: string | null;
  addressDetails?: string | null;
}) {
  const a = String(address ?? "").trim();
  const d = String(addressDetails ?? "").trim();
  if (!a && !d) return null;
  return (
    <div className="text-sm text-stone-700 dark:text-stone-200">
      <p className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Where</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        {a ? <span className="min-w-0 wrap-break-word font-medium">{a}</span> : null}
        {a && d ? (
          <span className="shrink-0 text-stone-300 dark:text-stone-600" aria-hidden>
            ·
          </span>
        ) : null}
        {d ? (
          <span className={`min-w-0 wrap-break-word ${a ? "text-stone-500 dark:text-stone-400" : "font-medium"}`}>{d}</span>
        ) : null}
      </p>
    </div>
  );
}
