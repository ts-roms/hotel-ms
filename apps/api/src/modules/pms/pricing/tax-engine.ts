/**
 * Splits a posted amount into net and tax lines (blueprint §15.1). Pure and exact: works
 * in integer minor units, and the parts always add up to the total the guest owes.
 *
 * - Inclusive taxes are contained in the posted amount (PH VAT: a ₱3,500 room contains
 *   ₱375 VAT). Net = round(amount × 10000 / (10000 + Σ inclusive bps)); the inclusive tax
 *   total is amount − net, split across inclusive taxes by rate, remainder to the last.
 * - Exclusive taxes are added on top of the net: round(net × bps / 10000) each.
 *
 * Rounding is half away from zero, so a reversal (negative amount) mirrors its original.
 */
export interface TaxRuleInput {
  code: string;
  name: string;
  rateBps: number;
  inclusive: boolean;
}

export interface TaxBreakdown {
  netMinor: bigint;
  taxes: { code: string; name: string; amountMinor: bigint }[];
  /** What the folio balance moves by: net + all taxes. */
  totalMinor: bigint;
}

export function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n); // half up on magnitudes
  return negative ? -q : q;
}

export function computeTaxes(amountMinor: bigint, rules: readonly TaxRuleInput[]): TaxBreakdown {
  const inclusive = rules.filter((r) => r.inclusive && r.rateBps > 0);
  const exclusive = rules.filter((r) => !r.inclusive && r.rateBps > 0);
  const inclusiveBps = BigInt(inclusive.reduce((sum, r) => sum + r.rateBps, 0));

  const net =
    inclusiveBps === 0n ? amountMinor : divRound(amountMinor * 10_000n, 10_000n + inclusiveBps);
  const taxes: TaxBreakdown['taxes'] = [];

  let remaining = amountMinor - net;
  inclusive.forEach((rule, index) => {
    const share =
      index === inclusive.length - 1
        ? remaining
        : divRound((amountMinor - net) * BigInt(rule.rateBps), inclusiveBps);
    remaining -= share;
    if (share !== 0n) taxes.push({ code: rule.code, name: rule.name, amountMinor: share });
  });

  for (const rule of exclusive) {
    const amount = divRound(net * BigInt(rule.rateBps), 10_000n);
    if (amount !== 0n) taxes.push({ code: rule.code, name: rule.name, amountMinor: amount });
  }

  const totalMinor = net + taxes.reduce((sum, t) => sum + t.amountMinor, 0n);
  return { netMinor: net, taxes, totalMinor };
}

export interface StatutoryDiscount {
  discountBps: number;
  exemptTaxCodes: readonly string[];
}

/**
 * Statutory discounts such as PH senior citizen / PWD (RA 9994, RA 10754): the holder is
 * exempt from some taxes and gets a discount on the price without them. Configuration
 * decides which taxes and how much; nothing here is specific to one country.
 *
 * - `base`: the posted amount with the exempt inclusive taxes taken out (a VAT-inclusive
 *   ₱3,500 becomes ₱3,125 VAT-exempt).
 * - `discount`: discountBps of that base (20% of ₱3,125 = ₱625).
 * - `rules`: the remaining (non-exempt) taxes, applied to `base` as usual.
 */
export function applyStatutoryDiscount(
  amountMinor: bigint,
  rules: readonly TaxRuleInput[],
  discount: StatutoryDiscount,
): { base: bigint; discount: bigint; rules: TaxRuleInput[] } {
  const exempt = new Set(discount.exemptTaxCodes);
  const exemptInclusiveBps = BigInt(
    rules.filter((r) => r.inclusive && exempt.has(r.code)).reduce((sum, r) => sum + r.rateBps, 0),
  );
  const base =
    exemptInclusiveBps === 0n
      ? amountMinor
      : divRound(amountMinor * 10_000n, 10_000n + exemptInclusiveBps);
  return {
    base,
    discount: divRound(base * BigInt(discount.discountBps), 10_000n),
    rules: rules.filter((r) => !exempt.has(r.code)),
  };
}
