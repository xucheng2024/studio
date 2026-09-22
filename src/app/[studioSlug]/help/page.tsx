import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getPublicStudioShell } from "@/lib/cachedPublicStudio";
import { studioMePath, studioServicesPath } from "@/lib/public-paths";
import { ui } from "@/lib/ui";

type Props = { params: Promise<{ studioSlug: string }> };
const guides = [
  ["Sign in and manage your profile", "Create or sign in to your account before viewing your bookings, orders, passes, and memberships.", "auth"],
  ["Book an appointment", "Choose a service, date, and available time. Review the details before confirming your booking.", "appointments"],
  ["Pay for an order", "Complete payment only once, then check Orders in your account for its latest status and receipt.", "orders"],
  ["View bookings and benefits", "Use your account to view upcoming bookings, class passes, memberships, and previous orders.", "account"],
  ["Cancel or change a booking", "Open the booking in your account and use the available option. Contact the studio if no change option is shown.", "bookings"],
] as const;

export default async function StudioHelpPage({ params }: Props) {
  const { studioSlug } = await params;
  const studio = await getPublicStudioShell(studioSlug);
  if (!studio) notFound();
  const links: Record<(typeof guides)[number][2], string> = {
    auth: `/${studio.public_slug}/auth`,
    appointments: `/${studio.public_slug}/appointments`,
    orders: studioMePath(studio.public_slug, "orders"),
    account: studioMePath(studio.public_slug),
    bookings: studioMePath(studio.public_slug, "bookings"),
  };
  const brand = studio.public_brand_name?.trim() || studio.name;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href={`/${studio.public_slug}`} className={ui.linkMuted}>← Back to {brand}</Link>
      <div className="mt-6"><h1 className={ui.h1}>Booking help</h1><p className={ui.muted}>Short answers for booking, payment, and your account.</p></div>
      <div className="mt-6 flex flex-col gap-3">
        {guides.map(([title, summary, key]) => <section key={title} className={ui.card}><h2 className={ui.h2}>{title}</h2><p className="mt-1 text-sm leading-relaxed text-stone-700 dark:text-stone-300">{summary}</p><Link href={links[key]} className={`${ui.btnSecondarySm} mt-4 w-fit`}>Continue<ChevronRight size={15} /></Link></section>)}
      </div>
      <section className={`${ui.card} mt-6`}><h2 className={ui.h2}>Need help from the studio?</h2><p className="mt-1 text-sm text-stone-700 dark:text-stone-300">Use the contact option on this site for booking questions that cannot be resolved from your account.</p>{studio.public_contact_email ? <a href={`mailto:${studio.public_contact_email}`} className={`${ui.btnSecondarySm} mt-4 w-fit`}>Email the studio</a> : <Link href={studioServicesPath(studio.public_slug)} className={`${ui.btnSecondarySm} mt-4 w-fit`}>View services</Link>}</section>
    </main>
  );
}
