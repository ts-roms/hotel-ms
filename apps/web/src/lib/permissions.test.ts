import type { Grant } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { hasPermission, hasPropertyPermission } from './permissions';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

const org = (permission: string): Grant => ({
  permission,
  scopeType: 'ORGANIZATION',
  propertyId: null,
});
const at = (permission: string, propertyId: string): Grant => ({
  permission,
  scopeType: 'PROPERTY',
  propertyId,
});

describe('hasPropertyPermission', () => {
  it('an organization-scoped grant covers every property', () => {
    const info = { grants: [org('folio.read')] };
    expect(hasPropertyPermission(info, 'folio.read', A)).toBe(true);
    expect(hasPropertyPermission(info, 'folio.read', B)).toBe(true);
  });

  it('a property-scoped grant covers only its property', () => {
    const info = { grants: [at('stay.check_in', A)] };
    expect(hasPropertyPermission(info, 'stay.check_in', A)).toBe(true);
    expect(hasPropertyPermission(info, 'stay.check_in', B)).toBe(false);
  });

  it('does not mix permissions', () => {
    const info = { grants: [at('reservation.read', A), org('room.read')] };
    expect(hasPropertyPermission(info, 'reservation.update', A)).toBe(false);
  });

  it('is false while signed out or loading', () => {
    expect(hasPropertyPermission(null, 'room.read', A)).toBe(false);
    expect(hasPropertyPermission(undefined, 'room.read', A)).toBe(false);
  });
});

describe('hasPermission', () => {
  it('holds a permission at any scope', () => {
    const info = { grants: [at('stay.check_in', A)] };
    expect(hasPermission(info, 'stay.check_in')).toBe(true);
    expect(hasPermission(info, 'stay.check_out')).toBe(false);
    expect(hasPermission(null, 'stay.check_in')).toBe(false);
  });
});
