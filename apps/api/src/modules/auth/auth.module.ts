import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { KioskAuth } from './kiosk-auth.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

/**
 * Platform (blueprint §6.1, §10): staff sessions, MFA, passwords, shared-device sign-in.
 * The global guards in guards.ts are registered by AppModule, in order.
 */
@Module({
  imports: [AccessModule],
  controllers: [AuthController],
  providers: [SessionService, AuthService, MfaService, PasswordService, KioskAuth],
  exports: [SessionService, KioskAuth],
})
export class AuthModule {}
