import type { ClsStore } from 'nestjs-cls';
import type { FastifyBaseLogger } from 'fastify';
import type { GrantSet } from '../modules/access/grant-set.js';

/**
 * Per-request context, carried through AsyncLocalStorage (nestjs-cls).
 *
 * Fields are filled in stages and are trustworthy only once the guard that sets them has
 * run: AuthGuard (session, identity) → TenantGuard (organization, membership, grants,
 * property). Nothing here is ever copied from request input without verification.
 */
export interface RequestContext extends ClsStore {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  log: FastifyBaseLogger;

  sessionId?: string;
  sessionTokenHash?: string;
  identityId?: string;
  /** Organization chosen at login / org switch, stored server-side on the session. */
  sessionOrganizationId?: string | null;
  /** Identity has a verified second factor. */
  mfaEnabled?: boolean;
  /** This session completed the second factor. Required for sensitive permissions. */
  mfaVerified?: boolean;

  /** Set by TenantGuard after verifying an ACTIVE membership. */
  organizationId?: string;
  membershipId?: string;
  grants?: GrantSet;
  /** Set by TenantGuard after verifying a :propertyId route param belongs to the org. */
  propertyId?: string;

  /**
   * Shared-device realm (ADR-0020): the request comes from a paired device with a staff
   * operator signed in on it. Grants are narrowed to the device's permissions there.
   */
  device?: {
    id: string;
    propertyId: string;
    permissions: readonly string[];
    operatorSessionId: string;
  };

  /** Set for work done on behalf of an external system (webhooks). */
  system?: boolean;

  /** Guest realm (GuestGuard): the session's reservation is the only thing a guest can reach. */
  guest?: {
    sessionId: string;
    tokenHash: string;
    reservationId: string;
    reservationRoomId: string;
    guestId: string;
    verified: boolean;
  };
}
