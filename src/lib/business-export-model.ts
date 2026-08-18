export type BusinessExportKind = "sales" | "customers" | "packages";

export const BUSINESS_EXPORT_KINDS = new Set<BusinessExportKind>(["sales", "customers", "packages"]);

export const SENSITIVE_EXPORT_HEADER_TOKENS = [
  "allerg",
  "health",
  "nric",
  "contraindicat",
  "bank",
  "password",
  "reaction_",
  "sensitive_note",
];

export const SALES_EXPORT_HEADERS = [
  "sale_item_id",
  "sale_number",
  "paid_at",
  "item_type",
  "item_name",
  "location_id",
  "employee_id",
  "service_id",
  "gross",
  "refunds",
  "net",
  "payment_status",
  "source",
  "sales_channel",
] as const;

export const CUSTOMER_EXPORT_HEADERS = [
  "customer_id",
  "full_name",
  "email",
  "phone",
  "status",
  "preferred_location_id",
  "source",
  "created_at",
] as const;

export const PACKAGE_EXPORT_HEADERS = [
  "package_id",
  "name",
  "credits",
  "price",
  "expiry_days",
  "location_id",
  "is_active",
] as const;

export function exportHeadersAreSafe(headers: readonly string[]) {
  const joined = headers.join(" ").toLowerCase();
  return !SENSITIVE_EXPORT_HEADER_TOKENS.some((token) => joined.includes(token));
}

export function parseBusinessExportKind(value: string | null | undefined): BusinessExportKind | null {
  const kind = (value ?? "").toLowerCase();
  return BUSINESS_EXPORT_KINDS.has(kind as BusinessExportKind) ? kind as BusinessExportKind : null;
}

export type CustomerExportSource = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  preferred_location_id: string | null;
  source: string | null;
  created_at: string | null;
};

export function filterCustomerExportRows(
  customers: CustomerExportSource[],
  filters: { q?: string; status?: string },
) {
  const keyword = filters.q?.trim().toLowerCase() ?? "";
  const status = filters.status?.trim().toLowerCase() ?? "";
  return customers.filter((customer) => {
    if (status && customer.status !== status) return false;
    if (!keyword) return true;
    const searchable = `${customer.full_name} ${customer.email ?? ""} ${customer.phone ?? ""}`.toLowerCase();
    return searchable.includes(keyword);
  });
}

export function customerExportTable(customers: CustomerExportSource[]) {
  return {
    headers: [...CUSTOMER_EXPORT_HEADERS],
    rows: customers.map((customer) => [
      customer.id,
      customer.full_name,
      customer.email ?? "",
      customer.phone ?? "",
      customer.status,
      customer.preferred_location_id ?? "",
      customer.source ?? "",
      customer.created_at ?? "",
    ]),
  };
}

export type PackageExportSource = {
  id: string;
  name: string;
  credits: number | null;
  price: number | string | null;
  expiry_days: number | null;
  location_id: string | null;
  is_active: boolean | null;
};

export function packageExportTable(packages: PackageExportSource[]) {
  return {
    headers: [...PACKAGE_EXPORT_HEADERS],
    rows: packages.map((row) => [
      row.id,
      row.name,
      row.credits ?? "",
      Number(row.price ?? 0).toFixed(2),
      row.expiry_days ?? "",
      row.location_id ?? "",
      row.is_active ? "true" : "false",
    ]),
  };
}

export type SaleExportSource = {
  sale_item_id: string;
  sale_number: string | null;
  paid_at: string | null;
  item_type: string | null;
  item_name: string | null;
  location_id: string | null;
  employee_id: string | null;
  service_id: string | null;
  gross: number;
  refunds: number;
  payment_status: string | null;
  source: string | null;
  sales_channel: string | null;
};

export function saleExportTable(rows: SaleExportSource[]) {
  return {
    headers: [...SALES_EXPORT_HEADERS],
    rows: rows.map((row) => [
      row.sale_item_id,
      row.sale_number ?? "",
      row.paid_at ?? "",
      row.item_type ?? "",
      row.item_name ?? "",
      row.location_id ?? "",
      row.employee_id ?? "",
      row.service_id ?? "",
      row.gross.toFixed(2),
      row.refunds.toFixed(2),
      (row.gross - row.refunds).toFixed(2),
      row.payment_status ?? "",
      row.source ?? "",
      row.sales_channel ?? "",
    ]),
  };
}
