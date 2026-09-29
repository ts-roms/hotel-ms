import { describe, expect, it } from 'vitest';
import { applyStatutoryDiscount, computeTaxes } from './tax-engine.js';

const VAT = { code: 'VAT', name: 'VAT 12%', rateBps: 1200, inclusive: true };
const CITY = { code: 'CITY', name: 'City tax 0.75%', rateBps: 75, inclusive: false };
const SC = { code: 'SVC', name: 'Service charge 10%', rateBps: 1000, inclusive: false };

describe('computeTaxes', () => {
  it('extracts inclusive VAT: ₱3,500.00 contains ₱375.00 VAT', () => {
    expect(computeTaxes(350_000n, [VAT])).toEqual({
      netMinor: 312_500n,
      taxes: [{ code: 'VAT', name: 'VAT 12%', amountMinor: 37_500n }],
      totalMinor: 350_000n,
    });
  });

  it('adds exclusive taxes on top of the net', () => {
    const result = computeTaxes(100_000n, [SC]);
    expect(result).toEqual({
      netMinor: 100_000n,
      taxes: [{ code: 'SVC', name: 'Service charge 10%', amountMinor: 10_000n }],
      totalMinor: 110_000n,
    });
  });

  it('combines inclusive and exclusive taxes', () => {
    const result = computeTaxes(112_000n, [VAT, CITY]);
    expect(result.netMinor).toBe(100_000n);
    expect(result.taxes).toEqual([
      { code: 'VAT', name: 'VAT 12%', amountMinor: 12_000n },
      { code: 'CITY', name: 'City tax 0.75%', amountMinor: 750n },
    ]);
    expect(result.totalMinor).toBe(112_750n);
  });

  it('parts always sum exactly to the total, for many awkward amounts', () => {
    const rules = [VAT, { code: 'LT', name: 'Local 1.5%', rateBps: 150, inclusive: true }, CITY];
    for (let amount = 1n; amount < 5_000n; amount += 7n) {
      const r = computeTaxes(amount, rules);
      const inclusivePart =
        r.netMinor +
        r.taxes.filter((t) => t.code !== 'CITY').reduce((s, t) => s + t.amountMinor, 0n);
      expect(inclusivePart).toBe(amount);
      expect(r.totalMinor).toBe(r.netMinor + r.taxes.reduce((s, t) => s + t.amountMinor, 0n));
    }
  });

  it('a negative amount mirrors the positive one (reversals, credits)', () => {
    const positive = computeTaxes(123_457n, [VAT, CITY]);
    const negative = computeTaxes(-123_457n, [VAT, CITY]);
    expect(negative.netMinor).toBe(-positive.netMinor);
    expect(negative.taxes.map((t) => t.amountMinor)).toEqual(
      positive.taxes.map((t) => -t.amountMinor),
    );
  });

  it('no rules: everything is net', () => {
    expect(computeTaxes(5_000n, [])).toEqual({ netMinor: 5_000n, taxes: [], totalMinor: 5_000n });
  });
});

describe('statutory discounts', () => {
  const vat = { code: 'VAT', name: 'VAT 12%', rateBps: 1200, inclusive: true };
  const senior = { discountBps: 2000, exemptTaxCodes: ['VAT'] };

  it('takes out the exempt VAT, then discounts 20% (PH senior citizen)', () => {
    const r = applyStatutoryDiscount(350_000n, [vat], senior);
    expect(r).toEqual({ base: 312_500n, discount: 62_500n, rules: [] });
    // The guest pays 2,500.00 for a 3,500.00 room.
    expect(r.base - r.discount).toBe(250_000n);
  });

  it('keeps taxes the holder is not exempt from', () => {
    const service = { code: 'SC', name: 'Service charge', rateBps: 1000, inclusive: false };
    const r = applyStatutoryDiscount(112_000n, [vat, service], senior);
    expect(r.base).toBe(100_000n);
    expect(r.discount).toBe(20_000n);
    expect(r.rules).toEqual([service]);
  });

  it('without exemptions only discounts', () => {
    expect(
      applyStatutoryDiscount(10_000n, [vat], { discountBps: 500, exemptTaxCodes: [] }),
    ).toEqual({
      base: 10_000n,
      discount: 500n,
      rules: [vat],
    });
  });
});
