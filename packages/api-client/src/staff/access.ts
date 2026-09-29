import type {
  AssignmentRequest,
  CreateRoleRequest,
  InviteMemberRequest,
  Member,
  PermissionInfo,
  RoleDto,
  UpdateMemberRequest,
  UpdateRoleRequest,
} from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, type Transport } from '../http.js';

/** Access: permissions, roles and members. */
export function accessClient({ call }: Transport) {
  return {
    access: {
      permissions: () => op.AccessController_permissions<PermissionInfo[]>(call).then(data),
      roles: () => op.AccessController_listRoles<RoleDto[]>(call).then(data),
      getRole: (roleId: string) => op.AccessController_getRole<RoleDto>(call, { roleId }),
      createRole: (body: CreateRoleRequest) =>
        op.AccessController_createRole<RoleDto>(call, body).then(data),
      updateRole: (roleId: string, etag: string, body: UpdateRoleRequest) =>
        op.AccessController_updateRole<RoleDto>(call, { roleId }, body, { ifMatch: etag }),
      deleteRole: (roleId: string) => op.AccessController_deleteRole(call, { roleId }).then(data),
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
  };
}
