/** Currencies supported for display. Amounts are always integer minor units (e.g. kobo, cents). */
const MINOR_DIGITS: Record<string, number> = { NGN: 2, USD: 2, GBP: 2, EUR: 2, GHS: 2, KES: 2, ZAR: 2 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

export function formatMoney(amountMinor: number | bigint | string, currency: string, locale = "en-NG"): string {
  const digits = minorDigits(currency);
  const minor = BigInt(amountMinor);
  const divisor = 10n ** BigInt(digits);
  const whole = minor / divisor;
  const frac = (minor < 0n ? -minor : minor) % divisor;
  const wholeStr = new Intl.NumberFormat(locale).format(whole);
  const symbol =
    new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency;
  return digits > 0 ? `${symbol}${wholeStr}.${frac.toString().padStart(digits, "0")}` : `${symbol}${wholeStr}`;
}
