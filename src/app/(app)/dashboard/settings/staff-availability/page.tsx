import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Moved into Settings → Online booking. Kept as a redirect so old links keep working. */
export default async function LegacyStaffAvailabilitySettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  query.set("tab", "staff");
  redirect(`/dashboard/settings/booking?${query.toString()}`);
}
