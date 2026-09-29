/**
 * Platform-operator command: make an identity a platform operator (ops dashboard,
 * ADR-0029), or take the role away. Runs with the database owner; the API cannot change
 * this column.
 *
 *   OPERATOR_EMAIL=ops@example.com OPERATOR_ACTION=grant node dist/ops/platform-operator.js
 *   OPERATOR_EMAIL=ops@example.com OPERATOR_ACTION=revoke node dist/ops/platform-operator.js
 *
 * Operators must sign in with two-step verification to open the dashboard. In AWS, run it
 * as a one-off task from the migrate task definition with a command override.
 */
import { createPrismaClient } from '../client.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const action = required('OPERATOR_ACTION');
if (action !== 'grant' && action !== 'revoke') throw new Error('OPERATOR_ACTION: grant or revoke');
const email = required('OPERATOR_EMAIL').toLowerCase();

const owner = createPrismaClient({
  connectionString: required('DATABASE_OWNER_URL'),
  applicationName: 'ops-platform-operator',
  maxConnections: 1,
});

try {
  const { count } = await owner.identity.updateMany({
    where: { email },
    data: { platformRole: action === 'grant' ? 'OPERATOR' : null },
  });
  if (count !== 1) throw new Error(`No identity with email ${email}`);
  console.log(`${email}: platform operator ${action === 'grant' ? 'granted' : 'revoked'}`);
} finally {
  await owner.$disconnect();
}
