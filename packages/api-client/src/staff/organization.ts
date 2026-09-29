import type {
  AssignmentRequest,
  AuditLogEntry,
  CreatePropertyRequest,
  CreateRoleRequest,
  FeatureFlag,
  Guest,
  InviteMemberRequest,
  Member,
  OrganizationDashboard,
  PermissionInfo,
  Property,
  RoleDto,
  SearchResult,
  UpdateMemberRequest,
  UpdatePropertyRequest,
  UpdateRoleRequest,
} from '@hotel/contracts';
import type { Page, Transport } from '../http.js';

/** Organization-level resources: dashboard, search, properties, access, flags, guests, audit log. */
export function organizationClient({ call, qs }: Transport) {
  return {
    /** Group overview (ADR-0025). */
    dashboard: () => call<OrganizationDashboard>('GET', '/dashboard').then((r) => r.data),
    search: (q: string) =>
      call<SearchResult>('GET', `/search${qs({ q })}`).then((r) => r.data.items),
    properties: {
      list: (params: { cursor?: string; limit?: number } = {}) =>
        call<Page<Property>>('GET', `/properties${qs(params)}`).then((r) => r.data),
      get: (id: string) => call<Property>('GET', `/properties/${encodeURIComponent(id)}`),
      create: (body: CreatePropertyRequest) =>
        call<Property>('POST', '/properties', body).then((r) => r.data),
      update: (id: string, etag: string, body: UpdatePropertyRequest) =>
        call<Property>('PATCH', `/properties/${encodeURIComponent(id)}`, body, {
          'if-match': etag,
        }),
    },
    access: {
      permissions: () => call<PermissionInfo[]>('GET', '/permissions').then((r) => r.data),
      roles: () => call<RoleDto[]>('GET', '/roles').then((r) => r.data),
      getRole: (id: string) => call<RoleDto>('GET', `/roles/${encodeURIComponent(id)}`),
      createRole: (body: CreateRoleRequest) =>
        call<RoleDto>('POST', '/roles', body).then((r) => r.data),
      updateRole: (id: string, etag: string, body: UpdateRoleRequest) =>
        call<RoleDto>('PATCH', `/roles/${encodeURIComponent(id)}`, body, { 'if-match': etag }),
      deleteRole: (id: string) =>
        call<void>('DELETE', `/roles/${encodeURIComponent(id)}`).then((r) => r.data),
      members: () => call<Member[]>('GET', '/members').then((r) => r.data),
      invite: (body: InviteMemberRequest) =>
        call<Member>('POST', '/members/invitations', body).then((r) => r.data),
      resendInvitation: (membershipId: string) =>
        call<void>('POST', `/members/${encodeURIComponent(membershipId)}/invitation`).then(
          (r) => r.data,
        ),
      updateMember: (membershipId: string, body: UpdateMemberRequest) =>
        call<Member>('PATCH', `/members/${encodeURIComponent(membershipId)}`, body).then(
          (r) => r.data,
        ),
      addAssignment: (membershipId: string, body: AssignmentRequest) =>
        call<Member>(
          'POST',
          `/members/${encodeURIComponent(membershipId)}/role-assignments`,
          body,
        ).then((r) => r.data),
      removeAssignment: (membershipId: string, assignmentId: string) =>
        call<Member>(
          'DELETE',
          `/members/${encodeURIComponent(membershipId)}/role-assignments/${encodeURIComponent(assignmentId)}`,
        ).then((r) => r.data),
    },
    featureFlags: {
      list: () =>
        call<{ items: FeatureFlag[] }>('GET', '/organization/feature-flags').then(
          (r) => r.data.items,
        ),
      set: (key: string, enabled: boolean) =>
        call<FeatureFlag>('PUT', `/organization/feature-flags/${encodeURIComponent(key)}`, {
          enabled,
        }).then((r) => r.data),
    },
    guests: {
      search: (q: string, limit = 20) =>
        call<Guest[]>('GET', `/guests${qs({ q, limit })}`).then((r) => r.data),
    },
    auditLogs: {
      list: (
        params: {
          propertyId?: string;
          entityType?: string;
          entityId?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ) => call<Page<AuditLogEntry>>('GET', `/audit-logs${qs(params)}`).then((r) => r.data),
    },
  };
}
