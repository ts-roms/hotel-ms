import type { Tx } from '@hotel/database';
import { Problems } from '../../common/problem.js';

/**
 * Serializes access-administration changes within one organization. Without it, two
 * administrators removing each other concurrently could both pass the "an administrator
 * remains" check and leave the organization unmanageable.
 */
export async function lockOrganization(tx: Tx, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
}

/**
 * At least one ACTIVE member must hold role.manage at organization scope. Call after the
 * mutation, inside the same (locked) transaction; throwing rolls the change back.
 */
export async function assertAdministratorRemains(tx: Tx): Promise<void> {
  const administrators = await tx.organizationMembership.count({
    where: {
      status: 'ACTIVE',
      roleAssignments: {
        some: {
          scopeType: 'ORGANIZATION',
          role: { permissions: { some: { permissionCode: 'role.manage' } } },
        },
      },
    },
  });
  if (administrators === 0) throw Problems.lastAdministrator();
}

/** Invalidates cached grants (ADR-0004) for the given memberships. */
export async function bumpGrantsVersion(tx: Tx, membershipIds: string[]): Promise<void> {
  if (membershipIds.length === 0) return;
  await tx.organizationMembership.updateMany({
    where: { id: { in: membershipIds } },
    data: { grantsVersion: { increment: 1 } },
  });
}
