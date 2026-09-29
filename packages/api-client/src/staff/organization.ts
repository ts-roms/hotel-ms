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
import * as op from '../generated/operations.js';
import { data, items, type Page, type Transport } from '../http.js';

/** Organization-level resources: dashboard, search, properties, access, flags, guests, audit log. */
export function organizationClient({ call }: Transport) {
  return {
    /** Group overview (ADR-0025). */
    dashboard: () => op.ManagementController_organization<OrganizationDashboard>(call).then(data),
    search: (q: string) => op.ManagementController_search<SearchResult>(call, { q }).then(items),
    properties: {
      list: (params: { cursor?: string; limit?: number } = {}) =>
        op.PropertiesController_list<Page<Property>>(call, params).then(data),
      get: (id: string) => op.PropertiesController_get<Property>(call, { propertyId: id }),
      create: (body: CreatePropertyRequest) =>
        op.PropertiesController_create<Property>(call, body).then(data),
      update: (id: string, etag: string, body: UpdatePropertyRequest) =>
        op.PropertiesController_update<Property>(call, { propertyId: id }, body, { ifMatch: etag }),
    },
    access: {
      permissions: () => op.AccessController_permissions<PermissionInfo[]>(call).then(data),
      roles: () => op.AccessController_listRoles<RoleDto[]>(call).then(data),
      getRole: (id: string) => op.AccessController_getRole<RoleDto>(call, { roleId: id }),
      createRole: (body: CreateRoleRequest) =>
        op.AccessController_createRole<RoleDto>(call, body).then(data),
      updateRole: (id: string, etag: string, body: UpdateRoleRequest) =>
        op.AccessController_updateRole<RoleDto>(call, { roleId: id }, body, { ifMatch: etag }),
      deleteRole: (id: string) => op.AccessController_deleteRole(call, { roleId: id }).then(data),
      members: () => op.AccessController_listMembers<Member[]>(call).then(data),
      invite: (body: InviteMemberRequest) =>
        op.AccessController_invite<Member>(call, body).then(data),
      resendInvitation: (membershipId: string) =>
        op.AccessController_resendInvitation(call, { membershipId }).then(data),
      updateMember: (membershipId: string, body: UpdateMemberRequest) =>
        op.AccessController_updateMember<Member>(call, { membershipId }, body).then(data),
      addAssignment: (membershipId: string, body: AssignmentRequest) =>
        op.AccessController_addAssignment<Member>(call, { membershipId }, body).then(data),
      removeAssignment: (membershipId: string, assignmentId: string) =>
        op
          .AccessController_removeAssignment<Member>(call, { membershipId, assignmentId })
          .then(data),
    },
    featureFlags: {
      list: () =>
        op.OrganizationController_featureFlags<{ items: FeatureFlag[] }>(call).then(items),
      set: (key: string, enabled: boolean) =>
        op
          .OrganizationController_setFeatureFlag<FeatureFlag>(call, { flagKey: key }, { enabled })
          .then(data),
    },
    guests: {
      search: (q: string, limit = 20) =>
        op.GuestsController_search<Guest[]>(call, { q, limit }).then(data),
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
      ) => op.AuditController_list<Page<AuditLogEntry>>(call, params).then(data),
    },
  };
}
