import { describe, expect, it } from 'vitest';
import { purgeOn } from './document-retention.js';

describe('retention date', () => {
  it('adds months to the termination date, clamping to the month end', () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(purgeOn(d('2026-10-31'), 12)).toBe('2027-10-31');
    expect(purgeOn(d('2026-01-31'), 1)).toBe('2026-02-28');
    expect(purgeOn(d('2027-12-31'), 2)).toBe('2028-02-29');
    expect(purgeOn(d('2026-03-15'), 60)).toBe('2031-03-15');
    expect(purgeOn(null, 12)).toBeNull();
    expect(purgeOn(d('2026-03-15'), null)).toBeNull();
  });
});
