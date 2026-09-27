import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { bootstrapRoles } from '../src/bootstrap/roles.js';

/**
 * Runs the bootstrap against the local Postgres with throwaway role and database names,
 * as the local superuser (standing in for the managed-database administrator).
 */
const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:55432/postgres';
const names = {
  database: 'bt_test_db',
  owner: 'bt_test_owner',
  app: 'bt_test_app',
  system: 'bt_test_system',
  groups: { app: 'bt_test_rw', system: 'bt_test_sys' },
};
const password = (label: string) => `${label}-password-long-enough-000000`;

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${names.database}`);
    for (const role of [
      names.owner,
      names.app,
      names.system,
      names.groups.app,
      names.groups.system,
    ]) {
      await c.query(`DROP ROLE IF EXISTS ${role}`);
    }
  });
});

describe('bootstrapRoles', () => {
  const options = (suffix: string) => ({
    adminUrl: ADMIN_URL,
    database: names.database,
    groups: names.groups,
    roles: {
      owner: { name: names.owner, password: password(`owner${suffix}`) },
      app: { name: names.app, password: password(`app${suffix}`) },
      system: { name: names.system, password: password(`system${suffix}`) },
    },
  });

  it('creates roles, memberships and an owned database; runtime roles cannot create objects', async () => {
    const actions = await bootstrapRoles(options('1'));
    expect(actions).toContain(`created database ${names.database}`);

    const memberships = await admin((c) =>
      c.query<{ member: string; group: string }>(
        `SELECT m.rolname AS member, g.rolname AS group FROM pg_auth_members am
         JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid
         WHERE m.rolname IN ($1, $2)`,
        [names.app, names.system],
      ),
    );
    expect(memberships.rows).toEqual(
      expect.arrayContaining([
        { member: names.app, group: names.groups.app },
        { member: names.system, group: names.groups.system },
      ]),
    );

    const appUrl = new URL(ADMIN_URL);
    appUrl.username = names.app;
    appUrl.password = password('app1');
    appUrl.pathname = `/${names.database}`;
    const app = new pg.Client({ connectionString: appUrl.toString() });
    await app.connect();
    await expect(app.query('CREATE TABLE should_fail (id int)')).rejects.toThrow(
      /permission denied/,
    );
    const flags = await app.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(flags.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await app.end();
  });

  it('is idempotent and rotates passwords', async () => {
    const actions = await bootstrapRoles(options('2'));
    expect(actions).not.toContain(`created database ${names.database}`);
    expect(actions).toContain(`updated ${names.app}`);

    const url = new URL(ADMIN_URL);
    url.username = names.app;
    url.pathname = `/${names.database}`;
    url.password = password('app1');
    await expect(new pg.Client({ connectionString: url.toString() }).connect()).rejects.toThrow();
    url.password = password('app2');
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    await client.end();
  });

  it('rejects unsafe identifiers and short passwords', async () => {
    await expect(
      bootstrapRoles({ ...options('3'), database: 'x; DROP DATABASE hotel' }),
    ).rejects.toThrow(/Invalid identifier/);
    await expect(
      bootstrapRoles({
        ...options('3'),
        roles: { ...options('3').roles, app: { name: names.app, password: 'short' } },
      }),
    ).rejects.toThrow(/too short/);
  });
});
