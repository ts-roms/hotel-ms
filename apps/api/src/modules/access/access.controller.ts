import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AssignmentRequest,
  assignmentRequestSchema,
  type CreateRoleRequest,
  createRoleRequestSchema,
  type InviteMemberRequest,
  inviteMemberRequestSchema,
  type Member,
  memberSchema,
  PERMISSION_CODES,
  PERMISSIONS,
  type PermissionInfo,
  permissionInfoSchema,
  type RoleDto,
  roleSchema,
  type UpdateMemberRequest,
  updateMemberRequestSchema,
  type UpdateRoleRequest,
  updateRoleRequestSchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { IfMatch, parseIfMatch, weakEtag } from '../../common/etag.js';
import { uuidParam } from '../../common/params.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodBody, ZodResponse } from '../../common/zod.js';
import { MembersService } from './members.service.js';
import { RolesService } from './roles.service.js';

@ApiTags('access')
@Controller()
export class AccessController {
  constructor(
    private readonly roles: RolesService,
    private readonly members: MembersService,
  ) {}

  // ---- Permissions catalog ------------------------------------------------------------

  @Get('permissions')
  @RequirePermission('role.read', 'any')
  @ZodResponse(200, z.array(permissionInfoSchema))
  permissions(): PermissionInfo[] {
    return PERMISSION_CODES.map((code) => {
      const def = PERMISSIONS[code];
      return {
        code,
        description: def.description,
        scopes: [...def.scopes],
        sensitive: 'sensitive' in def ? def.sensitive : false,
      };
    });
  }

  // ---- Roles --------------------------------------------------------------------------

  @Get('roles')
  @RequirePermission('role.read', 'any')
  @ZodResponse(200, z.array(roleSchema))
  listRoles(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @Post('roles')
  @RequirePermission('role.manage', 'organization')
  @HttpCode(201)
  @ZodResponse(201, roleSchema)
  createRole(@ZodBody(createRoleRequestSchema) body: CreateRoleRequest): Promise<RoleDto> {
    return this.roles.create(body);
  }

  @Get('roles/:roleId')
  @RequirePermission('role.read', 'any')
  @ZodResponse(200, roleSchema)
  async getRole(
    @Param('roleId') roleId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RoleDto> {
    const role = await this.roles.get(uuidParam(roleId));
    reply.header('etag', weakEtag(role.version));
    return role;
  }

  @Patch('roles/:roleId')
  @RequirePermission('role.manage', 'organization')
  @ZodResponse(200, roleSchema)
  async updateRole(
    @Param('roleId') roleId: string,
    @IfMatch() ifMatch: string | undefined,
    @ZodBody(updateRoleRequestSchema) body: UpdateRoleRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RoleDto> {
    const role = await this.roles.update(uuidParam(roleId), parseIfMatch(ifMatch), body);
    reply.header('etag', weakEtag(role.version));
    return role;
  }

  @Delete('roles/:roleId')
  @RequirePermission('role.manage', 'organization')
  @HttpCode(204)
  async deleteRole(@Param('roleId') roleId: string): Promise<void> {
    await this.roles.delete(uuidParam(roleId));
  }

  // ---- Members ------------------------------------------------------------------------

  @Get('members')
  @RequirePermission('member.read', 'any')
  @ZodResponse(200, z.array(memberSchema))
  listMembers(): Promise<Member[]> {
    return this.members.list();
  }

  @Get('members/:membershipId')
  @RequirePermission('member.read', 'any')
  @ZodResponse(200, memberSchema)
  getMember(@Param('membershipId') membershipId: string): Promise<Member> {
    return this.members.get(uuidParam(membershipId));
  }

  @Post('members/invitations')
  @RequirePermission('member.invite', 'any')
  @HttpCode(201)
  @ZodResponse(201, memberSchema, 'Member created with status INVITED; invitation emailed')
  invite(@ZodBody(inviteMemberRequestSchema) body: InviteMemberRequest): Promise<Member> {
    return this.members.invite(body);
  }

  @Post('members/:membershipId/invitation')
  @RequirePermission('member.invite', 'any')
  @HttpCode(204)
  async resendInvitation(@Param('membershipId') membershipId: string): Promise<void> {
    await this.members.resendInvitation(uuidParam(membershipId));
  }

  @Patch('members/:membershipId')
  @RequirePermission('member.update', 'any')
  @ZodResponse(200, memberSchema)
  updateMember(
    @Param('membershipId') membershipId: string,
    @ZodBody(updateMemberRequestSchema) body: UpdateMemberRequest,
  ): Promise<Member> {
    return this.members.updateStatus(uuidParam(membershipId), body);
  }

  @Post('members/:membershipId/role-assignments')
  @RequirePermission('role.assign', 'any')
  @HttpCode(201)
  @ZodResponse(201, memberSchema)
  addAssignment(
    @Param('membershipId') membershipId: string,
    @ZodBody(assignmentRequestSchema) body: AssignmentRequest,
  ): Promise<Member> {
    return this.members.addAssignment(uuidParam(membershipId), body);
  }

  @Delete('members/:membershipId/role-assignments/:assignmentId')
  @RequirePermission('role.assign', 'any')
  @ZodResponse(200, memberSchema)
  removeAssignment(
    @Param('membershipId') membershipId: string,
    @Param('assignmentId') assignmentId: string,
  ): Promise<Member> {
    return this.members.removeAssignment(uuidParam(membershipId), uuidParam(assignmentId));
  }
}
