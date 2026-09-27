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
  MemberInvited: { membershipId: string; identityId: string };
  MemberJoined: { membershipId: string; identityId: string };
  MemberStatusChanged: { membershipId: string; status: string };
  RoleAssigned: {
    membershipId: string;
    assignmentId: string;
    roleId: string;
    propertyId: string | null;
  };
  RoleUnassigned: {
    membershipId: string;
    assignmentId: string;
    roleId: string;
    propertyId: string | null;
  };
  RoleCreated: { roleId: string; key: string };
  RoleUpdated: { roleId: string; changedFields: string[] };
  RoleDeleted: { roleId: string; key: string };
}

export type DomainEventType = keyof DomainEventPayloads;
