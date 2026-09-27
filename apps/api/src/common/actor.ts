import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from './request-context.js';

/**
 * Who is acting in this request, for audit rows and events: a staff member, a guest, or
 * the system (e.g. a payment provider's webhook).
 */
export function actorOf(cls: ClsService<RequestContext>): {
  actorType: 'MEMBER' | 'GUEST' | 'SYSTEM';
  actorId: string | null;
} {
  if (cls.get('system')) return { actorType: 'SYSTEM', actorId: null };
  const guest = cls.get('guest');
  if (guest) return { actorType: 'GUEST', actorId: guest.guestId };
  return { actorType: 'MEMBER', actorId: cls.get('identityId') ?? null };
}
