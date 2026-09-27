import { z } from 'zod';

export const ACTOR_TYPES = ['MEMBER', 'GUEST', 'DEVICE', 'SYSTEM', 'PLATFORM_OPERATOR'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const auditLogEntrySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  propertyId: z.uuid().nullable(),
  actorType: z.enum(ACTOR_TYPES),
  actorId: z.uuid().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  requestId: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogQuerySchema = z.object({
  propertyId: z.uuid().optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
