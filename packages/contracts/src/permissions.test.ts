import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_CODES, permissionAllowsScope } from './permissions.js';
import { ROLE_TEMPLATES } from './role-templates.js';

describe('permission catalog', () => {
  it('uses resource.action codes', () => {
    for (const code of PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });

  it('every permission is grantable at organization scope', () => {
    for (const code of PERMISSION_CODES) {
      expect(permissionAllowsScope(code, 'ORGANIZATION')).toBe(true);
    }
  });

  it('role templates only reference known permissions, without duplicates', () => {
    for (const template of ROLE_TEMPLATES) {
      for (const code of template.permissions) {
        expect(Object.hasOwn(PERMISSIONS, code)).toBe(true);
      }
      expect(new Set(template.permissions).size).toBe(template.permissions.length);
    }
  });

  it('org_admin holds every permission', () => {
    const admin = ROLE_TEMPLATES.find((t) => t.key === 'org_admin');
    expect(new Set(admin?.permissions)).toEqual(new Set(PERMISSION_CODES));
  });
});
