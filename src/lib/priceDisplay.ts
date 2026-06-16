export function isZeroAmount(value: number | null | undefined): boolean {
  return Number(value ?? 0) === 0;
}

export function formatPriceOrFree(currency: string, value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  if (amount === 0) return "Free";
  return `${currency} ${amount.toFixed(2)}`;
}
