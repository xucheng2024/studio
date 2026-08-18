export function formatPosInvoiceLineItem(params: {
  receiptNumber?: string | null;
  saleNumber?: string | null;
  itemNames: string[];
}) {
  const names = params.itemNames.map((name) => name.trim()).filter(Boolean);
  const extra = names.length > 3 ? ` +${names.length - 3} more` : "";
  const items = names.slice(0, 3).join(", ");
  const receipt = params.receiptNumber?.trim();
  const sale = params.saleNumber?.trim();
  if (!names.length) {
    if (receipt) return `POS receipt ${receipt}`;
    if (sale) return `POS sale ${sale}`;
    return "POS sale";
  }
  if (receipt) return `POS receipt ${receipt}: ${items}${extra}`;
  if (sale) return `POS sale ${sale}: ${items}${extra}`;
  return `POS sale: ${items}${extra}`;
}
