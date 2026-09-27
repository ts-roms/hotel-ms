/**
 * Platform-operator command: create an organization and its first administrator.
 * The administrator gets no password; they set one through "Forgot password", which also
 * proves they control the email address.
 *
 *   ORG_NAME="ABC Hospitality Group" ORG_SLUG=abc-hospitality \
 *   ADMIN_EMAIL=gm@abc.example ADMIN_NAME="Ana Admin" \
 *   node dist/ops/provision-organization.js
 *
 * In AWS, run it as a one-off task from the migrate task definition with a command
 * override (docs/operations/staging-setup.md). Idempotent on ORG_SLUG.
 */
import { createPrismaClient } from '../client.js';
import { provisionOrganization } from '../provisioning.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const app = createPrismaClient({
  connectionString: required('DATABASE_URL'),
  applicationName: 'ops-provision',
  maxConnections: 1,
});

try {
  const slug = required('ORG_SLUG');
  const email = required('ADMIN_EMAIL').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))
    throw new Error('ORG_SLUG must be lowercase letters, digits and dashes');

  // Organizations are invisible without tenant context, so an existing slug is detected
  // by its unique constraint on insert (P2002) rather than by a lookup.
  const admin =
    (await app.identity.findUnique({ where: { email } })) ??
    (await app.identity.create({ data: { email, displayName: required('ADMIN_NAME') } }));

  try {
    const { organizationId } = await provisionOrganization(app, {
      name: required('ORG_NAME'),
      slug,
      defaultLocale: process.env.ORG_LOCALE ?? 'en-PH',
      defaultCurrency: process.env.ORG_CURRENCY ?? 'PHP',
      defaultTimezone: process.env.ORG_TIMEZONE ?? 'Asia/Manila',
      adminIdentityId: admin.id,
      actorIdentityId: null,
    });
    console.log(
      JSON.stringify({
        msg: 'organization provisioned',
        organizationId,
        slug,
        adminIdentityId: admin.id,
      }),
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === 'P2002') {
      console.log(JSON.stringify({ msg: 'organization already exists', slug }));
    } else {
      throw error;
    }
  }
} finally {
  await app.$disconnect();
}
