import { describe, expect, it } from 'vitest';
import { GrantSet } from './grant-set.js';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';
const C = '00000000-0000-7000-8000-00000000000c';

describe('GrantSet', () => {
  const grants = new GrantSet([
    { permission: 'property.read', scopeType: 'PROPERTY', propertyId: A },
    { permission: 'property.read', scopeType: 'PROPERTY', propertyId: B },
    { permission: 'audit.read', scopeType: 'ORGANIZATION', propertyId: null },
  ]);

  it('property scope covers only the listed properties', () => {
    expect(grants.hasForProperty('property.read', A)).toBe(true);
    expect(grants.hasForProperty('property.read', B)).toBe(true);
    expect(grants.hasForProperty('property.read', C)).toBe(false);
    expect(grants.hasAtOrganization('property.read')).toBe(false);
  });

  it('organization scope covers every property', () => {
    expect(grants.hasAtOrganization('audit.read')).toBe(true);
    expect(grants.hasForProperty('audit.read', C)).toBe(true);
  });

  it('absent permissions are denied everywhere', () => {
    expect(grants.hasAnywhere('property.update')).toBe(false);
    expect(grants.hasForProperty('property.update', A)).toBe(false);
    expect(grants.propertyScope('property.update')).toEqual({ kind: 'some', propertyIds: [] });
  });

  it('computes list scopes', () => {
    expect(grants.propertyScope('property.read')).toEqual({ kind: 'some', propertyIds: [A, B] });
    expect(grants.propertyScope('audit.read')).toEqual({ kind: 'all' });
  });

  it('round-trips through JSON (cache format)', () => {
    const copy = new GrantSet(grants.toJSON());
    expect(copy.toJSON()).toEqual(grants.toJSON());
  });
});
