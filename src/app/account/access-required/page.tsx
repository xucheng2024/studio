import Link from "next/link";
import { ShieldAlert, MailCheck } from "lucide-react";
import { ui } from "@/lib/ui";

export default function AccessRequiredPage() {
  return (
    <main className={ui.pageNarrow}>
      <div className={ui.card}>
        <div className="mb-4 inline-flex size-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <ShieldAlert size={20} />
        </div>
        <h1 className={ui.h1}>Access approval required</h1>
        <p className={`mt-3 ${ui.lead}`}>
          This staff portal is invitation-only.
        </p>
        <p className={`mt-2 ${ui.muted}`}>
          Ask your studio owner (or superadmin) to authorize this email as an owner/staff account, then sign in again.
        </p>
        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
          <span className="inline-flex items-center gap-2 font-medium">
            <MailCheck size={15} />
            Need access?
          </span>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Share this email with your owner/admin and ask them to add you in Staff invites.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/auth" className={ui.btnPrimarySm}>
            Back to staff sign in
          </Link>
          <Link href="/booking" className={ui.btnSecondarySm}>
            Browse classes
          </Link>
        </div>
      </div>
    </main>
  );
}
