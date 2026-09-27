/**
 * Member and role administration: invitations, anti-escalation, scope, last-administrator
 * protection and grant-cache invalidation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Mailbox, startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let john: TestClient;
let xyzAdmin: TestClient;
let roleIds: Record<string, string>;
let membershipIds: Record<string, string>;

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  john = await TestClient.withMfa(ctx.app, 'john.gm@abc.test');
  xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');

  const roles = await admin.get('/api/v1/roles');
  roleIds = Object.fromEntries(roles.body.map((r: { key: string; id: string }) => [r.key, r.id]));
  const members = await admin.get('/api/v1/members');
  membershipIds = Object.fromEntries(
    members.body.map((m: { email: string; membershipId: string }) => [m.email, m.membershipId]),
  );
});

afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

const P = () => ctx.world.abc.properties;

describe('invitation lifecycle', () => {
  it('admin invites a new person; they set a password and join with exactly the granted scope', async () => {
    const invite = await admin.request('POST', '/api/v1/members/invitations', {
      email: 'new.hire@abc.test',
      displayName: 'Nina Hire',
      assignments: [{ roleId: roleIds.staff, propertyId: P().DVO }],
    });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('INVITED');

    const mail = await ctx.mailbox.latestFor('new.hire@abc.test', 'member-invitation');
    expect(mail?.template === 'member-invitation' && mail.data.organizationName).toBe(
      'ABC Hospitality Group',
    );
    const token = Mailbox.tokenFrom(
      mail!.template === 'member-invitation' ? mail!.data.acceptUrl : '',
    );

    const visitor = new TestClient(ctx.app);
    const preview = await visitor.request('POST', '/api/v1/auth/invitations/preview', { token });
    expect(preview.body).toEqual({
      organizationName: 'ABC Hospitality Group',
      email: 'new.hire@abc.test',
      requiresPassword: true,
    });

    const noPassword = await visitor.request('POST', '/api/v1/auth/invitations/accept', { token });
    expect(noPassword.status).toBe(400);
    const accepted = await visitor.request('POST', '/api/v1/auth/invitations/accept', {
      token,
      password: 'a long enough password',
    });
    expect(accepted.status).toBe(204);
    expect(
      (
        await visitor.request('POST', '/api/v1/auth/invitations/accept', {
          token,
          password: 'a long enough password',
        })
      ).status,
    ).toBe(400);

    const newbie = new TestClient(ctx.app);
    expect((await newbie.login('new.hire@abc.test', 'a long enough password')).status).toBe(200);
    const props = await newbie.get('/api/v1/properties');
    expect(props.body.items.map((p: { code: string }) => p.code)).toEqual(['DVO']);
  });

  it('inviting an existing identity keeps their account and password', async () => {
    const res = await xyzAdmin.request('POST', '/api/v1/members/invitations', {
      email: 'john.gm@abc.test',
      displayName: 'Ignored Name',
      assignments: [
        {
          roleId: (await xyzAdmin.get('/api/v1/roles')).body.find(
            (r: { key: string }) => r.key === 'staff',
          ).id,
          propertyId: null,
        },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.displayName).toBe('John Reyes');
    const mail = await ctx.mailbox.latestFor('john.gm@abc.test', 'member-invitation');
    const token = Mailbox.tokenFrom(
      mail!.template === 'member-invitation' ? mail!.data.acceptUrl : '',
    );
    const preview = await new TestClient(ctx.app).request(
      'POST',
      '/api/v1/auth/invitations/preview',
      { token },
    );
    expect(preview.body.requiresPassword).toBe(false);
  });

  it('refuses duplicates and unknown tokens', async () => {
    const dup = await admin.request('POST', '/api/v1/members/invitations', {
      email: 'maria.hr@abc.test',
      displayName: 'Maria',
      assignments: [{ roleId: roleIds.staff, propertyId: P().MNL }],
    });
    expect(dup.status).toBe(409);
    const bogus = await new TestClient(ctx.app).request(
      'POST',
      '/api/v1/auth/invitations/preview',
      { token: 'B'.repeat(43) },
    );
    expect(bogus.status).toBe(400);
    expect(bogus.body.code).toBe('INVALID_TOKEN');
  });
});

describe('anti-escalation', () => {
  it('a property GM can grant a subset of their own access at their own property', async () => {
    const res = await john.request('POST', '/api/v1/members/invitations', {
      email: 'mnl.auditor@abc.test',
      displayName: 'Manila Auditor',
      assignments: [{ roleId: roleIds.auditor, propertyId: P().MNL }],
    });
    expect(res.status).toBe(201);
  });

  it('a property GM cannot grant at another property or organization-wide', async () => {
    for (const propertyId of [P().CEB, null]) {
      const res = await john.request('POST', '/api/v1/members/invitations', {
        email: `escalate-${propertyId ?? 'org'}@abc.test`,
        displayName: 'Escalation Attempt',
        assignments: [{ roleId: roleIds.staff, propertyId }],
      });
      expect(res.status).toBe(403);
    }
  });

  it('custom roles are grantable within scope; members without role.assign cannot grant', async () => {
    const created = await admin.request('POST', '/api/v1/roles', {
      key: 'settings_editor',
      name: 'Settings editor',
      permissions: ['property.read', 'property.settings.manage', 'role.read'],
    });
    expect(created.status).toBe(201);
    // Every permission in it is one John (GM) holds at MNL, so he may grant it there.
    const ok = await john.request(
      'POST',
      `/api/v1/members/${membershipIds['maria.hr@abc.test']}/role-assignments`,
      {
        roleId: created.body.id,
        propertyId: P().MNL,
      },
    );
    expect(ok.status).toBe(201);

    // Maria (auditor) holds no role.assign at all.
    const maria = await TestClient.withMfa(ctx.app, 'maria.hr@abc.test');
    const denied = await maria.request(
      'POST',
      `/api/v1/members/${membershipIds['maria.hr@abc.test']}/role-assignments`,
      {
        roleId: roleIds.org_admin,
        propertyId: P().MNL,
      },
    );
    expect(denied.status).toBe(403);
  });

  it('an assigner cannot hand out permissions they do not hold themselves', async () => {
    // Can assign roles at CEB, but does not hold audit.read.
    const assigner = await admin.request('POST', '/api/v1/roles', {
      key: 'assigner',
      name: 'Assigner',
      permissions: ['property.read', 'member.read', 'member.invite', 'role.read', 'role.assign'],
    });
    expect(assigner.status).toBe(201);
    const granted = await admin.request(
      'POST',
      `/api/v1/members/${membershipIds['frontdesk@abc.test']}/role-assignments`,
      {
        roleId: assigner.body.id,
        propertyId: P().CEB,
      },
    );
    expect(granted.status).toBe(201);

    const frontDesk = await TestClient.withMfa(ctx.app, 'frontdesk@abc.test');
    const escalate = await frontDesk.request('POST', '/api/v1/members/invitations', {
      email: 'ceb.auditor@abc.test',
      displayName: 'Cebu Auditor',
      // The auditor role holds permissions frontDesk lacks (audit.read, HR read access).
      assignments: [{ roleId: roleIds.auditor, propertyId: P().CEB }],
    });
    expect(escalate.status).toBe(403);
    expect(escalate.body.detail).toMatch(/^Cannot grant \S+: you do not hold it/);

    const selfEscalate = await frontDesk.request(
      'POST',
      `/api/v1/members/${membershipIds['frontdesk@abc.test']}/role-assignments`,
      {
        roleId: roleIds.general_manager,
        propertyId: P().CEB,
      },
    );
    expect(selfEscalate.status).toBe(403);

    const allowed = await frontDesk.request('POST', '/api/v1/members/invitations', {
      email: 'ceb.staff@abc.test',
      displayName: 'Cebu Staff',
      assignments: [{ roleId: roleIds.staff, propertyId: P().CEB }],
    });
    expect(allowed.status).toBe(201);
  });

  it('roles can only be defined with permissions held organization-wide; GMs cannot define roles', async () => {
    expect(
      (
        await john.request('POST', '/api/v1/roles', {
          key: 'x_role',
          name: 'X',
          permissions: ['property.read'],
        })
      ).status,
    ).toBe(403);
  });
});

describe('scope of member administration', () => {
  it('a property GM sees only members holding a role at their property', async () => {
    const res = await john.get('/api/v1/members');
    const emails = res.body.map((m: { email: string }) => m.email).sort();
    expect(emails).toContain('maria.hr@abc.test'); // auditor at MNL
    expect(emails).toContain('john.gm@abc.test');
    expect(emails).not.toContain('robert.finance@abc.test'); // org-scope only
    expect(emails).not.toContain('frontdesk@abc.test'); // CEB only
  });

  it('cannot suspend a member whose access reaches beyond their scope', async () => {
    // Maria holds MNL and CEB; John only covers MNL.
    const res = await john.request(
      'PATCH',
      `/api/v1/members/${membershipIds['maria.hr@abc.test']}`,
      { status: 'SUSPENDED' },
    );
    expect(res.status).toBe(403);
    const invisible = await john.request(
      'PATCH',
      `/api/v1/members/${membershipIds['robert.finance@abc.test']}`,
      { status: 'SUSPENDED' },
    );
    expect(invisible.status).toBe(404);
  });

  it('another tenant cannot see or touch these members', async () => {
    expect(
      (await xyzAdmin.get(`/api/v1/members/${membershipIds['maria.hr@abc.test']}`)).status,
    ).toBe(404);
    const res = await xyzAdmin.request(
      'POST',
      `/api/v1/members/${membershipIds['maria.hr@abc.test']}/role-assignments`,
      {
        roleId: roleIds.staff,
        propertyId: null,
      },
    );
    expect(res.status).toBe(404);
    const plant = await xyzAdmin.request('POST', '/api/v1/members/invitations', {
      email: 'plant@xyz.test',
      displayName: 'Planted',
      assignments: [{ roleId: roleIds.staff, propertyId: P().MNL }],
    });
    expect(plant.status).toBe(400);
  });
});

describe('suspension and grant freshness', () => {
  it('suspension takes effect on the next request; reactivation restores access', async () => {
    const frontDesk = await TestClient.as(ctx.app, 'frontdesk@abc.test');
    expect((await frontDesk.get('/api/v1/properties')).status).toBe(200);

    const suspended = await admin.request(
      'PATCH',
      `/api/v1/members/${membershipIds['frontdesk@abc.test']}`,
      { status: 'SUSPENDED' },
    );
    expect(suspended.body.status).toBe('SUSPENDED');
    const blocked = await frontDesk.get('/api/v1/properties');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('NO_ACTIVE_ORGANIZATION');

    await admin.request('PATCH', `/api/v1/members/${membershipIds['frontdesk@abc.test']}`, {
      status: 'ACTIVE',
    });
    expect((await frontDesk.get('/api/v1/properties')).status).toBe(200);
  });

  it('new assignments apply immediately despite the grants cache', async () => {
    const robert = await TestClient.as(ctx.app, 'robert.finance@abc.test');
    await robert.get('/api/v1/properties'); // warm the cache
    const res = await admin.request(
      'POST',
      `/api/v1/members/${membershipIds['robert.finance@abc.test']}/role-assignments`,
      {
        roleId: roleIds.general_manager,
        propertyId: P().DVO,
      },
    );
    expect(res.status).toBe(201);
    const dvo = await robert.get(`/api/v1/properties/${P().DVO}`);
    const patch = await robert.request(
      'PATCH',
      `/api/v1/properties/${P().DVO}`,
      { phone: '+63 82 111 2222' },
      { 'if-match': String(dvo.headers.etag) },
    );
    expect(patch.status).toBe(200);

    const dup = await admin.request(
      'POST',
      `/api/v1/members/${membershipIds['robert.finance@abc.test']}/role-assignments`,
      {
        roleId: roleIds.general_manager,
        propertyId: P().DVO,
      },
    );
    expect(dup.status).toBe(409);
  });
});

describe('last administrator protection', () => {
  it('cannot suspend yourself', async () => {
    const res = await admin.request('PATCH', `/api/v1/members/${membershipIds['admin@abc.test']}`, {
      status: 'SUSPENDED',
    });
    expect(res.status).toBe(403);
  });

  it('cannot remove the only organization-wide administrator assignment', async () => {
    const me = await admin.get(`/api/v1/members/${membershipIds['admin@abc.test']}`);
    const assignment = me.body.assignments.find(
      (a: { roleKey: string }) => a.roleKey === 'org_admin',
    );
    const res = await admin.request(
      'DELETE',
      `/api/v1/members/${membershipIds['admin@abc.test']}/role-assignments/${assignment.id}`,
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_ADMINISTRATOR');
  });

  it('cannot strip role.manage from the role that the only administrator holds', async () => {
    const role = await admin.get(`/api/v1/roles/${roleIds.org_admin}`);
    const res = await admin.request(
      'PATCH',
      `/api/v1/roles/${roleIds.org_admin}`,
      { permissions: role.body.permissions.filter((p: string) => p !== 'role.manage') },
      { 'if-match': String(role.headers.etag) },
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_ADMINISTRATOR');
  });
});

describe('roles', () => {
  it('create, rename with If-Match, and refuse deleting a role in use', async () => {
    const created = await admin.request('POST', '/api/v1/roles', {
      key: 'night_auditor',
      name: 'Night auditor',
      permissions: ['property.read', 'audit.read'],
    });
    expect(created.status).toBe(201);
    expect(
      (
        await admin.request('POST', '/api/v1/roles', {
          key: 'night_auditor',
          name: 'Dup',
          permissions: ['property.read'],
        })
      ).status,
    ).toBe(409);

    const url = `/api/v1/roles/${created.body.id}`;
    expect((await admin.request('PATCH', url, { name: 'Night Auditor' })).status).toBe(428);
    const renamed = await admin.request(
      'PATCH',
      url,
      { name: 'Night Auditor' },
      { 'if-match': 'W/"1"' },
    );
    expect(renamed.status).toBe(200);
    expect(
      (await admin.request('PATCH', url, { name: 'Stale' }, { 'if-match': 'W/"1"' })).status,
    ).toBe(412);

    const settingsEditor = (await admin.get('/api/v1/roles')).body.find(
      (r: { key: string }) => r.key === 'settings_editor',
    );
    expect((await admin.request('DELETE', `/api/v1/roles/${settingsEditor.id}`)).status).toBe(409);
    expect((await admin.request('DELETE', url)).status).toBe(204);
  });

  it('every access change is audited', async () => {
    const res = await admin.get('/api/v1/audit-logs?limit=100');
    const actions = new Set(res.body.items.map((e: { action: string }) => e.action));
    for (const action of [
      'member.invited',
      'member.joined',
      'member.status_changed',
      'role.assigned',
      'role.created',
      'role.updated',
      'role.deleted',
    ]) {
      expect(actions).toContain(action);
    }
  });
});
