/**
 * Entry point for the db-bootstrap ECS task. Credentials arrive as environment variables
 * injected from Secrets Manager by ECS; nothing is logged except the actions taken.
 */
import { bootstrapRoles } from './roles.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const adminUrl = new URL(
  `postgresql://${required('DB_HOST')}:${process.env.DB_PORT ?? '5432'}/postgres`,
);
adminUrl.username = encodeURIComponent(required('DB_ADMIN_USERNAME'));
adminUrl.password = encodeURIComponent(required('DB_ADMIN_PASSWORD'));
adminUrl.searchParams.set('sslmode', process.env.DB_SSLMODE ?? 'require');

const actions = await bootstrapRoles({
  adminUrl: adminUrl.toString(),
  database: process.env.DB_NAME ?? 'hotel',
  roles: {
    owner: { name: 'hotel_owner', password: required('DB_OWNER_PASSWORD') },
    app: { name: 'hotel_app', password: required('DB_APP_PASSWORD') },
    system: { name: 'hotel_system', password: required('DB_SYSTEM_PASSWORD') },
  },
});
console.log(JSON.stringify({ msg: 'database roles bootstrapped', actions }));
