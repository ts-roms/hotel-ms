import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from './request-context.js';

/** Who is acting in this request, for audit rows and events: a staff member or a guest. */
export function actorOf(cls: ClsService<RequestContext>): {
  actorType: 'MEMBER' | 'GUEST';
  actorId: string | null;
} {
  const guest = cls.get('guest');
  if (guest) return { actorType: 'GUEST', actorId: guest.guestId };
  return { actorType: 'MEMBER', actorId: cls.get('identityId') ?? null };
}
