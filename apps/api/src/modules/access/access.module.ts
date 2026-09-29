import { Module } from '@nestjs/common';
import { AccessController } from './access.controller.js';
import { GrantsService } from './grants.service.js';
import { InvitationsService } from './invitations.service.js';
import { MembersService } from './members.service.js';
import { RolesService } from './roles.service.js';

/** Access (blueprint §6.1, §9): memberships, roles, role assignments, grants. */
@Module({
  controllers: [AccessController],
  providers: [GrantsService, MembersService, RolesService, InvitationsService],
  exports: [GrantsService, InvitationsService],
})
export class AccessModule {}
