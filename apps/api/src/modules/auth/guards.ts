import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { PERMISSIONS, type PermissionCode } from '@hotel/contracts';
import {
  ALLOW_MFA_PENDING,
  GUEST_ROUTE,
  IS_PUBLIC,
  IS_WEBHOOK,
  NO_ORGANIZATION,
  type PermissionRequirement,
  REQUIRED_PERMISSION,
} from '../../common/route-metadata.js';
import { TenantDb } from '../../infrastructure/database.js';
import { GrantsService } from '../access/grants.service.js';
import { KioskAuth } from './kiosk-auth.js';
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

/** Guest portal routes are authenticated by GuestGuard, not the staff pipeline. */
export function isGuestRoute(reflector: Reflector, ctx: ExecutionContext): boolean {
  return reflector.getAllAndOverride(GUEST_ROUTE, [ctx.getHandler(), ctx.getClass()]) !== undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly kiosk: KioskAuth,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /**
   * Shared-device realm (ADR-0020): a paired device with a staff operator signed in. It
   * reaches tenant routes only (never account, session or organization routes); the
   * operator's grants are narrowed in TenantGuard.
   */
  private async deviceRealm(ctx: ExecutionContext, req: FastifyRequest): Promise<boolean> {
    if (flag(this.reflector, NO_ORGANIZATION, ctx) || flag(this.reflector, ALLOW_MFA_PENDING, ctx))
      throw Problems.unauthenticated();
    const device = await this.kiosk.device(req);
    const operator = device ? await this.kiosk.operator(req, device) : null;
    if (!device || !operator) throw Problems.unauthenticated();
    if (
      !SAFE_METHODS.has(req.method) &&
      !this.kiosk.verifyCsrf(device.tokenHash, req.headers['x-csrf-token'])
    )
      throw Problems.csrf();

    this.cls.set('mfaEnabled', false);
    this.cls.set('mfaVerified', false);
    this.cls.set('identityId', operator.identityId);
    // Trusted: the organization of the device row the token resolved to.
    this.cls.set('sessionOrganizationId', device.organizationId);
    this.cls.set('device', {
      id: device.id,
      propertyId: device.propertyId,
      permissions: device.permissions,
      operatorSessionId: operator.sessionId,
    });
    this.cls.set(
      'log',
      this.cls.get('log').child({ identityId: operator.identityId, deviceId: device.id }),
    );
    return true;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const unsafe = !SAFE_METHODS.has(req.method);

    if (
      unsafe &&
      !flag(this.reflector, IS_WEBHOOK, ctx) &&
      !this.sessions.isAllowedOrigin(req.headers.origin)
    ) {
      throw Problems.csrf();
    }
    if (flag(this.reflector, IS_PUBLIC, ctx) || isGuestRoute(this.reflector, ctx)) return true;

    const token = req.cookies[this.sessions.cookieName];
    // A signed-in kiosk operator wins over a staff session in the same browser: device
    // browsers are dedicated, and the device realm can only narrow what is allowed.
    if (this.kiosk.hasOperatorCookie(req) || (!token && this.kiosk.hasDeviceCookie(req)))
      return this.deviceRealm(ctx, req);
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

    const { session, mfaEnabled } = resolved;
    const mfaVerified = mfaEnabled && session.mfaVerifiedAt !== null;
    if (mfaEnabled && !mfaVerified && !flag(this.reflector, ALLOW_MFA_PENDING, ctx)) {
      throw Problems.mfaRequired();
    }

    this.cls.set('mfaEnabled', mfaEnabled);
    this.cls.set('mfaVerified', mfaVerified);
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
    if (
      flag(this.reflector, IS_PUBLIC, ctx) ||
      flag(this.reflector, NO_ORGANIZATION, ctx) ||
      isGuestRoute(this.reflector, ctx)
    )
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

    // A shared device works at its own property only, with its own permissions only.
    const device = this.cls.get('device');
    if (device && routePropertyId !== device.propertyId) throw Problems.notFound('Property');
    const effective = device
      ? grants.restrictTo(
          // property.read keeps "not allowed here" a 403 at the device's own property.
          ['property.read', ...(device.permissions as PermissionCode[])],
          device.propertyId,
        )
      : grants;

    this.cls.set('organizationId', organizationId);
    this.cls.set('membershipId', membership.id);
    this.cls.set('grants', effective);
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
    if (
      flag(this.reflector, IS_PUBLIC, ctx) ||
      flag(this.reflector, NO_ORGANIZATION, ctx) ||
      isGuestRoute(this.reflector, ctx)
    )
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

    // Platform minimum (blueprint §10): sensitive permissions only work from an
    // MFA-verified session, whatever the organization's own settings say. Checked after
    // the grant so callers without the permission learn nothing more than before.
    const definition = PERMISSIONS[permission];
    if ('sensitive' in definition && definition.sensitive && !this.cls.get('mfaVerified')) {
      throw Problems.mfaEnrollmentRequired(permission);
    }
    return true;
  }
}
