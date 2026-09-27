import { describe, expect, it } from 'vitest';
import { createPropertyRequestSchema, updatePropertyRequestSchema } from './properties.js';

describe('property request schemas', () => {
  it('a partial update never fills in defaults for omitted fields', () => {
    expect(updatePropertyRequestSchema.parse({ name: 'Renamed Hotel' })).toEqual({
      name: 'Renamed Hotel',
    });
  });

  it('update cannot change code, timezone or currency', () => {
    for (const field of ['code', 'timezone', 'currency', 'organizationId']) {
      expect(updatePropertyRequestSchema.safeParse({ [field]: 'X' }).success).toBe(false);
    }
  });

  it('create applies check-in/out defaults and rejects unknown fields', () => {
    const base = {
      code: 'MNL2',
      name: 'Hotel',
      timezone: 'Asia/Manila',
      currency: 'PHP',
      locale: 'en-PH',
      countryCode: 'PH',
    };
    expect(createPropertyRequestSchema.parse(base)).toMatchObject({
      checkInTime: '14:00',
      checkOutTime: '12:00',
    });
    expect(
      createPropertyRequestSchema.safeParse({ ...base, organizationId: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(
      createPropertyRequestSchema.safeParse({ ...base, timezone: 'Mars/Olympus' }).success,
    ).toBe(false);
  });
});
