/**
 * Domain event envelope and catalog (ADR-0005). Events are written to the transactional
 * outbox in the same database transaction as the change that caused them.
 */
export interface DomainEventEnvelope<TType extends string = string, TPayload = unknown> {
  eventId: string;
  type: TType;
  version: number;
  occurredAt: string;
  organizationId: string;
  propertyId: string | null;
  actor: { type: string; id: string | null };
  correlationId: string | null;
  payload: TPayload;
}

export interface DomainEventPayloads {
  PropertyCreated: { propertyId: string; code: string; name: string };
  PropertyUpdated: { propertyId: string; changedFields: string[] };
  MemberSignedIn: { identityId: string };
}

export type DomainEventType = keyof DomainEventPayloads;
