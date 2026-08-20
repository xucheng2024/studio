export function isZeroAmount(value: number | null | undefined): boolean {
  return Number(value ?? 0) === 0;
}

export function formatPriceOrFree(currency: string, value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (amount === 0) return "Free";
  return `${currency} ${amount.toFixed(2)}`;
}

export function discountPercentOff(originalPrice: number | null | undefined, price: number | null | undefined): number | null {
  const original = Number(originalPrice ?? 0);
  const current = Number(price ?? 0);
  if (!original || original <= current) return null;
  return Math.round((1 - current / original) * 100);
}
