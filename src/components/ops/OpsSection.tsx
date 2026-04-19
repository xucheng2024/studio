import { Children } from "react";
import { ui } from "@/lib/ui";

export function OpsSection({
  title,
  description,
  children,
  emptyText,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  emptyText: string;
}) {
  // Children.toArray filters out null/undefined/false — so length > 0 means
  // there is at least one real renderable node (not just nulls from ternaries).
  const hasItems = Children.toArray(children).length > 0;
  return (
    <section className={ui.card}>
      <h2 className={ui.h2}>{title}</h2>
      <p className={`mt-1 ${ui.muted}`}>{description}</p>
      <div className="mt-4">{hasItems ? children : <p className={ui.muted}>{emptyText}</p>}</div>
    </section>
  );
}
