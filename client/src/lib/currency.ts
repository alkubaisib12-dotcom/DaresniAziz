// client/src/lib/currency.ts

const CURRENCY = "BHD";

export function formatMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;

  // Format with up to 2 decimal places, removing trailing zeros
  const formatted = safe.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return `${CURRENCY} ${formatted}`;
}

// If you store prices as cents (e.g. 1000 = 1.000 BHD)
export function formatFromCents(cents?: number | null): string {
  const value = typeof cents === "number" ? cents / 100 : 0;
  return formatMoney(value);
}
