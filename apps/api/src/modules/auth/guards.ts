import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import {
  IS_PUBLIC,
  NO_ORGANIZATION,
  type PermissionRequirement,
  REQUIRED_PERMISSION,
} from '../../common/route-metadata.js';
import { TenantDb } from '../../infrastructure/database.js';
import { GrantsService } from '../access/grants.service.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Guard pipeline (registered in this order as APP_GUARDs; blueprint §8.1):
 *   AuthGuard       → who is calling (session), CSRF + Origin for unsafe methods
 *   TenantGuard     → which organization (from the session, verified membership) and
 *                     which property (route param, verified to belong to the org)
 *   PermissionGuard → may they do this here (deny by default)
 */

function flag(reflector: Reflector, key: string, ctx: ExecutionContext): boolean {
  return reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]) === true;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const unsafe = !SAFE_METHODS.has(req.method);

    if (unsafe && !this.sessions.isAllowedOrigin(req.headers.origin)) throw Problems.csrf();
    if (flag(this.reflector, IS_PUBLIC, ctx)) return true;

    const token = req.cookies[this.sessions.cookieName];
    const resolved = token ? await this.sessions.resolve(token) : null;
    if (!resolved) throw Problems.unauthenticated();

    const csrfHeader = req.headers['x-csrf-token'];
    if (
      unsafe &&
      !this.sessions.verifyCsrf(
        resolved.tokenHash,
        typeof csrfHeader === 'string' ? csrfHeader : undefined,
      )
    ) {
      throw Problems.csrf();
    }

    const { session } = resolved;
    this.cls.set('sessionId', session.id);
    this.cls.set('sessionTokenHash', resolved.tokenHash);
    this.cls.set('identityId', session.identityId);
    this.cls.set('sessionOrganizationId', session.activeOrganizationId);
    this.cls.set('log', this.cls.get('log').child({ identityId: session.identityId }));
    return true;
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContext>,
    private readonly tenantDb: TenantDb,
    private readonly grants: GrantsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (flag(this.reflector, IS_PUBLIC, ctx) || flag(this.reflector, NO_ORGANIZATION, ctx))
      return true;

    const identityId = this.cls.get('identityId')!;
    // Trusted: stored server-side on the session, never read from the request.
    const organizationId = this.cls.get('sessionOrganizationId');
    if (!organizationId) throw Problems.noActiveOrganization();

    const req = ctx
      .switchToHttp()
      .getRequest<FastifyRequest<{ Params: { propertyId?: string } }>>();
    const routePropertyId = req.params?.propertyId;
    if (routePropertyId !== undefined && !UUID_RE.test(routePropertyId))
      throw Problems.notFound('Property');

    const { membership, grants, propertyFound } = await this.tenantDb.runWithTrustedContext(
      { organizationId, identityId },
      async (tx) => {
        const membership = await tx.organizationMembership.findUnique({
          where: { organizationId_identityId: { organizationId, identityId } },
          select: { id: true, status: true, grantsVersion: true },
        });
        if (!membership || membership.status !== 'ACTIVE') {
          return { membership: null, grants: null, propertyFound: false };
        }
        const grants = await this.grants.load(tx, organizationId, membership);
        const propertyFound = routePropertyId
          ? (await tx.property.count({ where: { id: routePropertyId } })) === 1
          : true;
        return { membership, grants, propertyFound };
      },
    );

    if (!membership || !grants) throw Problems.noActiveOrganization();
    // Property of another organization is indistinguishable from a missing one (404).
    if (!propertyFound) throw Problems.notFound('Property');

    this.cls.set('organizationId', organizationId);
    this.cls.set('membershipId', membership.id);
    this.cls.set('grants', grants);
    if (routePropertyId) this.cls.set('propertyId', routePropertyId);
    this.cls.set('log', this.cls.get('log').child({ organizationId, propertyId: routePropertyId }));
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (flag(this.reflector, IS_PUBLIC, ctx) || flag(this.reflector, NO_ORGANIZATION, ctx))
      return true;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      REQUIRED_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    // Deny by default: a tenant route that forgot to declare a permission is unusable.
    if (!requirement) throw Problems.forbidden('Route has no permission declaration');

    const grants = this.cls.get('grants')!;
    const propertyId = this.cls.get('propertyId');
    const { permission, mode } = requirement;

    const allowed =
      mode === 'any'
        ? grants.hasAnywhere(permission)
        : mode === 'organization' || !propertyId
          ? grants.hasAtOrganization(permission)
          : grants.hasForProperty(permission, propertyId);

    if (!allowed) {
      // Property routes answer 404 for properties outside the caller's scope, the same
      // as for other tenants' properties, so a scoped user cannot probe for them.
      if (propertyId && mode === 'route' && !grants.hasForProperty('property.read', propertyId)) {
        throw Problems.notFound('Property');
      }
      throw Problems.forbidden(`Missing permission ${permission}`);
    }
    return true;
  }
}
