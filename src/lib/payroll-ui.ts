import { localISODate } from "@/lib/date";
import { ui } from "@/lib/ui";

export function previousSgtMonth(from = new Date()) {
  const [year, month] = localISODate(from).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function payrollStatusBadgeClass(status: string) {
  if (status === "draft") return ui.badgeAmber;
  if (status === "voided") return ui.badgeRed;
  if (status === "finalised" || status === "paid") return ui.badge;
  return ui.badgeNeutral;
}

export function payrollStatusLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "finalised") return "Finalised";
  if (status === "paid") return "Paid";
  if (status === "voided") return "Voided";
  return status;
}
