import { Suspense } from "react";
import { PackageSectionTabs } from "@/components/dashboard/PackageSectionTabs";
import { ui } from "@/lib/ui";

export default function PackagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className={ui.h1}>Packages</h1>
        <Suspense fallback={<div className="h-9" />}>
          <PackageSectionTabs />
        </Suspense>
      </div>
      {children}
    </div>
  );
}
