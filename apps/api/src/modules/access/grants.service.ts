import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type Grant,
  isPermissionCode,
  PERMISSION_CODES,
  PERMISSIONS,
  permissionAllowsScope,
} from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { CacheRedis } from '../../infrastructure/redis.js';
import { GrantSet } from '../../common/grant-set.js';

const CACHE_TTL_SECONDS = 600;

/**
 * Fingerprint of the permission catalog this build knows. Grants are filtered through the
 * catalog, so during a rolling deploy an old instance would cache a set without the new
 * release's permissions under the same grants_version. Keying the cache by catalog keeps
 * each build's entries apart.
 */
export const CATALOG_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify(PERMISSION_CODES.map((code) => [code, PERMISSIONS[code].scopes])))
  .digest('hex')
  .slice(0, 12);

@Injectable()
export class GrantsService {
  constructor(private readonly redis: CacheRedis) {}

  /**
   * Effective grants for a membership. Cached per grants_version (and catalog), so any role
   * or assignment change (which bumps the version) is visible on the next request.
   */
  async load(
    tx: Tx,
    organizationId: string,
    membership: { id: string; grantsVersion: number },
  ): Promise<GrantSet> {
    const key = CacheRedis.tenantKey(
      organizationId,
      'grants',
      membership.id,
      String(membership.grantsVersion),
      CATALOG_FINGERPRINT,
    );

    const cached = await this.redis.client.get(key).catch(() => null);
    if (cached) return new GrantSet(JSON.parse(cached) as Grant[]);

    const assignments = await tx.roleAssignment.findMany({
      where: { membershipId: membership.id },
      select: {
        scopeType: true,
        propertyId: true,
        role: { select: { permissions: { select: { permissionCode: true } } } },
      },
    });

    const grants: Grant[] = [];
    for (const assignment of assignments) {
      for (const { permissionCode } of assignment.role.permissions) {
        // Ignore grants at scopes the permission does not support (e.g. property.create
        // assigned at a single property) instead of silently widening them.
        if (!isPermissionCode(permissionCode)) continue;
        if (!permissionAllowsScope(permissionCode, assignment.scopeType)) continue;
        grants.push({
          permission: permissionCode,
          scopeType: assignment.scopeType,
          propertyId: assignment.propertyId,
        });
      }
    }

    const set = new GrantSet(grants);
    await this.redis.client
      .set(key, JSON.stringify(set.toJSON()), 'EX', CACHE_TTL_SECONDS)
      .catch(() => undefined);
    return set;
  }
}
