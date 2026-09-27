import { describe, expect, it } from 'vitest';
import { canDefineRole, canGrantRole, coversMember } from './access-policy.js';
import { GrantSet } from './grant-set.js';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';

const org = (...permissions: string[]) =>
  permissions.map((permission) => ({
    permission,
    scopeType: 'ORGANIZATION' as const,
    propertyId: null,
  }));
const at = (propertyId: string, ...permissions: string[]) =>
  permissions.map((permission) => ({ permission, scopeType: 'PROPERTY' as const, propertyId }));

const GM_PERMS = ['property.read', 'property.update', 'member.read', 'role.assign'];

describe('canGrantRole', () => {
  const gmAtA = new GrantSet(at(A, ...GM_PERMS));

  it('allows granting a subset of own permissions at an own property', () => {
    expect(
      canGrantRole(gmAtA, ['property.read'], { scopeType: 'PROPERTY', propertyId: A }).ok,
    ).toBe(true);
  });

  it('blocks granting at another property', () => {
    expect(
      canGrantRole(gmAtA, ['property.read'], { scopeType: 'PROPERTY', propertyId: B }).ok,
    ).toBe(false);
  });

  it('blocks granting at organization scope from a property grant', () => {
    expect(
      canGrantRole(gmAtA, ['property.read'], { scopeType: 'ORGANIZATION', propertyId: null }).ok,
    ).toBe(false);
  });

  it('blocks granting a permission the actor does not hold (escalation)', () => {
    const result = canGrantRole(gmAtA, ['property.read', 'audit.read'], {
      scopeType: 'PROPERTY',
      propertyId: A,
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('audit.read') });
  });

  it('ignores permissions that cannot apply at the target scope', () => {
    // property.create is organization-only; granting such a role at a property confers nothing.
    expect(
      canGrantRole(gmAtA, ['property.read', 'property.create'], {
        scopeType: 'PROPERTY',
        propertyId: A,
      }).ok,
    ).toBe(true);
  });

  it('requires role.assign itself', () => {
    const noAssign = new GrantSet(at(A, 'property.read'));
    expect(
      canGrantRole(noAssign, ['property.read'], { scopeType: 'PROPERTY', propertyId: A }).ok,
    ).toBe(false);
  });

  it('organization admins can grant anything they hold anywhere', () => {
    const admin = new GrantSet(org('role.assign', 'property.read', 'audit.read'));
    expect(canGrantRole(admin, ['audit.read'], { scopeType: 'PROPERTY', propertyId: B }).ok).toBe(
      true,
    );
    expect(
      canGrantRole(admin, ['audit.read'], { scopeType: 'ORGANIZATION', propertyId: null }).ok,
    ).toBe(true);
  });
});

describe('coversMember', () => {
  const gmAtA = new GrantSet(at(A, 'member.update'));

  it('covers a member whose access is entirely within the actor scope', () => {
    expect(coversMember(gmAtA, 'member.update', [{ scopeType: 'PROPERTY', propertyId: A }])).toBe(
      true,
    );
  });

  it('does not cover a member with access elsewhere', () => {
    expect(
      coversMember(gmAtA, 'member.update', [
        { scopeType: 'PROPERTY', propertyId: A },
        { scopeType: 'PROPERTY', propertyId: B },
      ]),
    ).toBe(false);
    expect(
      coversMember(gmAtA, 'member.update', [{ scopeType: 'ORGANIZATION', propertyId: null }]),
    ).toBe(false);
  });

  it('property-scoped actors cannot act on members without assignments', () => {
    expect(coversMember(gmAtA, 'member.update', [])).toBe(false);
    expect(coversMember(new GrantSet(org('member.update')), 'member.update', [])).toBe(true);
  });
});

describe('canDefineRole', () => {
  it('requires every permission at organization scope', () => {
    const admin = new GrantSet(org('role.manage', 'property.read'));
    expect(canDefineRole(admin, ['property.read']).ok).toBe(true);
    expect(canDefineRole(admin, ['property.read', 'audit.read']).ok).toBe(false);
    expect(canDefineRole(new GrantSet(org('property.read')), ['property.read']).ok).toBe(false);
  });
});
