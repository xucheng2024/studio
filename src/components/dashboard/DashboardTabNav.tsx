import { DashboardAppLink } from "@/components/DashboardAppLink";

export function DashboardTabNav({
  tabs,
  activeKey,
  ariaLabel,
}: {
  tabs: { key: string; label: string; href: string }[];
  activeKey: string;
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800/80">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <DashboardAppLink
              key={tab.key}
              href={tab.href}
              scroll={false}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                active
                  ? "bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-100"
                  : "text-stone-600 dark:text-stone-300"
              }`}
            >
              {tab.label}
            </DashboardAppLink>
          );
        })}
      </div>
    </nav>
  );
}
