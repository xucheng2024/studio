import Link from "next/link";
import { ui } from "@/lib/ui";

export default function StudioBookingNotFound() {
  return (
    <main className={ui.pageNarrow}>
      <div className={`${ui.card} mx-auto max-w-md text-center`}>
        <h1 className={ui.h2}>Studio not found</h1>
        <p className={`mt-2 text-sm ${ui.muted}`}>
          This link may be wrong or the studio changed their URL. Ask for an updated booking link.
        </p>
        <Link href="/" className={`${ui.btnPrimary} mt-8 inline-flex w-full justify-center`}>
          Back home
        </Link>
      </div>
    </main>
  );
}
