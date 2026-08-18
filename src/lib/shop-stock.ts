export function isShopStockLow(
  stockQty: number | null | undefined,
  minStockQty: number | null | undefined,
): boolean {
  if (stockQty == null || minStockQty == null) return false;
  return Number(stockQty) <= Number(minStockQty);
}
