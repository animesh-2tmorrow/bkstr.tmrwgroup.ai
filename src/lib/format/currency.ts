// Phase 3 Stream 3 — money formatter.
// Phase 3 is USD-only (D9.7); shape future-proofs for multi-currency by
// keeping cents-as-integer end to end. Use Intl.NumberFormat so locale
// conventions (the comma vs the period for thousands/decimal) are correct
// in any consumer locale that mounts this string in the DOM.

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsdCents(cents: number): string {
  return USD.format(cents / 100);
}
