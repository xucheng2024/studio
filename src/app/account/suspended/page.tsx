import { ShieldAlert } from "lucide-react";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ui } from "@/lib/ui";

export default function SuspendedAccountPage() {
  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-md">
        <div className={`${ui.card} space-y-4`}>
          {/* Icon + badge */}
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400">
              <ShieldAlert size={20} />
            </span>
            <p className={ui.badge}>Workspace suspended</p>
          </div>

          <h1 className={ui.h1}>Studio access is temporarily unavailable</h1>
          <p className={ui.muted}>
            This workspace is currently suspended, so owner and staff backoffice access is locked.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            Contact your platform admin to reactivate the studio contract, then sign in again.
          </div>
          <div className="flex flex-wrap gap-2">
            <DashboardAppLink href="/booking" className={ui.btnSecondarySm}>
              Open booking page
            </DashboardAppLink>
            <DashboardAppLink href="/auth" className={ui.btnPrimary}>
              Sign in with another account
            </DashboardAppLink>
          </div>
        </div>
      </div>
    </main>
  );
}

