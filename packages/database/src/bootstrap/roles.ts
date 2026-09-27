import pg from 'pg';

/**
 * Creates or updates the database roles the application needs (ADR-0003), connected as
 * the managed database's administrator. Idempotent: safe to run on every deploy, and it
 * rotates passwords to the values currently in the secret store.
 *
 * Runs as a one-off ECS task before migrations. Locally, docker-compose does the same
 * with infrastructure/docker/postgres-init.sql.
 */
export interface BootstrapOptions {
  adminUrl: string;
  database: string;
  roles: {
    owner: { name: string; password: string };
    app: { name: string; password: string };
    system: { name: string; password: string };
  };
  /** NOLOGIN group roles referenced by grants and RLS policies in migrations. */
  groups?: { app: string; system: string };
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export async function bootstrapRoles(options: BootstrapOptions): Promise<string[]> {
  const groups = options.groups ?? { app: 'app_rw', system: 'app_system' };
  const names = [
    options.database,
    groups.app,
    groups.system,
    ...Object.values(options.roles).map((r) => r.name),
  ];
  for (const name of names) {
    if (!IDENTIFIER.test(name)) throw new Error(`Invalid identifier: ${name}`);
  }
  for (const role of Object.values(options.roles)) {
    if (role.password.length < 24) throw new Error(`Password for ${role.name} is too short`);
  }

  const client = new pg.Client({ connectionString: options.adminUrl });
  await client.connect();
  const actions: string[] = [];
  // Utility statements (CREATE/ALTER ROLE) cannot take bind parameters, so statements are
  // built server-side with format(%I, %L), which quotes identifiers and literals safely.
  const exec = async (template: string, ...args: string[]) => {
    const { rows } = await client.query<{ sql: string }>(
      'SELECT format($1::text, VARIADIC $2::text[]) AS sql',
      [template, args],
    );
    await client.query(rows[0]!.sql);
  };
  const roleExists = async (name: string) =>
    (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name])).rowCount === 1;

  try {
    for (const group of [groups.app, groups.system]) {
      if (!(await roleExists(group))) {
        await exec('CREATE ROLE %I NOLOGIN', group);
        actions.push(`created group ${group}`);
      }
    }

    const logins: [{ name: string; password: string }, string | null][] = [
      [options.roles.owner, null],
      [options.roles.app, groups.app],
      [options.roles.system, groups.system],
    ];
    for (const [role, group] of logins) {
      if (await roleExists(role.name)) {
        await exec('ALTER ROLE %I WITH LOGIN PASSWORD %L', role.name, role.password);
        actions.push(`updated ${role.name}`);
      } else {
        await exec('CREATE ROLE %I WITH LOGIN PASSWORD %L', role.name, role.password);
        actions.push(`created ${role.name}`);
      }
      if (group) await exec('GRANT %I TO %I', group, role.name);
    }

    const db = await client.query(
      'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1',
      [options.database],
    );
    // Managed Postgres admins are not superusers: they need membership to hand over ownership.
    await exec('GRANT %I TO CURRENT_USER', options.roles.owner.name);
    if (db.rowCount === 0) {
      await exec('CREATE DATABASE %I OWNER %I', options.database, options.roles.owner.name);
      actions.push(`created database ${options.database}`);
    } else if (db.rows[0].owner !== options.roles.owner.name) {
      await exec('ALTER DATABASE %I OWNER TO %I', options.database, options.roles.owner.name);
      actions.push(`database ${options.database} now owned by ${options.roles.owner.name}`);
    }
    // Runtime roles connect but never create objects.
    await exec('REVOKE CREATE ON DATABASE %I FROM PUBLIC', options.database);
    for (const role of [options.roles.app.name, options.roles.system.name]) {
      await exec('GRANT CONNECT ON DATABASE %I TO %I', options.database, role);
    }
  } finally {
    await client.end();
  }
  return actions;
}
