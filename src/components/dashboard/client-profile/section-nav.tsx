import { DashboardAppLink } from "@/components/DashboardAppLink";

export const CLIENT_PROFILE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "health", label: "Health" },
  { id: "appointments", label: "Appointments" },
  { id: "treatments", label: "Treatments" },
  { id: "purchases", label: "Purchases" },
  { id: "follow-up", label: "Follow-up" },
  { id: "consent", label: "Consent" },
  { id: "audit", label: "Audit" },
] as const;

export type ClientProfileSectionId = (typeof CLIENT_PROFILE_SECTIONS)[number]["id"];

export function parseClientProfileSection(value: string | null | undefined): ClientProfileSectionId {
  const match = CLIENT_PROFILE_SECTIONS.find((section) => section.id === value);
  return match?.id ?? "overview";
}

export function ClientProfileSectionNav({
  activeSection,
  hrefFor,
  healthAlert,
  pendingFollowUps,
}: {
  activeSection: ClientProfileSectionId;
  hrefFor: (section: ClientProfileSectionId) => string;
  healthAlert: boolean;
  pendingFollowUps: number;
}) {
  return (
    <div className="mt-3">
      <nav aria-label="Customer profile sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {CLIENT_PROFILE_SECTIONS.map((section) => {
          const active = section.id === activeSection;
          const badge =
            section.id === "health" && healthAlert
              ? "Alert"
              : section.id === "follow-up" && pendingFollowUps > 0
                ? String(pendingFollowUps)
                : null;
          return (
            <DashboardAppLink
              key={section.id}
              href={hrefFor(section.id)}
              scroll={false}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
                active
                  ? "bg-teal-600 text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
              }`}
            >
              {section.label}
              {badge ? (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  }`}
                >
                  {badge}
                </span>
              ) : null}
            </DashboardAppLink>
          );
        })}
      </nav>
      <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
        Daily: Appointments, Treatments, Purchases, Follow-up. Records: Health, Consent, Audit.
      </p>
    </div>
  );
}
