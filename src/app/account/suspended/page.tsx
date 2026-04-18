import { DashboardAppLink } from "@/components/DashboardAppLink";
import { ui } from "@/lib/ui";

export default function SuspendedAccountPage() {
  return (
    <main className={ui.page}>
      <div className="mx-auto max-w-2xl">
        <div className={`${ui.card} space-y-4`}>
          <p className={ui.badge}>Workspace suspended</p>
          <h1 className={ui.h1}>Studio access is temporarily unavailable</h1>
          <p className={ui.muted}>
            This workspace is currently suspended, so owner and staff backoffice access is locked.
          </p>
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-300">
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

