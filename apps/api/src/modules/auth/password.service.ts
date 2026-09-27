import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { hashPassword, verifyPassword } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { RateLimiter } from '../../infrastructure/redis.js';
import { SessionService } from './session.service.js';

const RESET_TOKEN_MINUTES = 30;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The password may not contain the email's local part (a common, guessable choice). */
function assertAcceptablePassword(password: string, email: string): void {
  const local = email.split('@')[0]!.toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    throw Problems.validation([
      { path: 'newPassword', message: 'Do not use your email address in your password' },
    ]);
  }
}

@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationsQueue,
    private readonly rateLimiter: RateLimiter,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Always succeeds from the caller's point of view, so it cannot be used to discover
   * accounts. A new request invalidates earlier unused links.
   */
  async requestReset(email: string): Promise<void> {
    const ip = this.cls.get('ip') ?? 'unknown';
    await this.rateLimiter.consume(`pwreset:ip:${ip}`, 10, 15 * 60);
    await this.rateLimiter.consume(
      `pwreset:email:${sha256(email.toLowerCase()).slice(0, 32)}`,
      3,
      15 * 60,
    );

    const identity = await this.prisma.platform.identity.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true, status: true },
    });
    if (!identity || identity.status !== 'ACTIVE') {
      this.cls
        .get('log')
        .info({ event: 'auth.password_reset_requested', known: false }, 'password reset requested');
      return;
    }

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.platform.$transaction([
      this.prisma.platform.passwordResetToken.updateMany({
        where: { identityId: identity.id, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.platform.passwordResetToken.create({
        data: {
          identityId: identity.id,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + RESET_TOKEN_MINUTES * 60_000),
          requestedIp: this.cls.get('ip'),
        },
      }),
    ]);

    // The token travels in the URL fragment, which browsers never send to servers or in
    // Referer headers, so it does not end up in access logs.
    await this.notifications.sendEmail({
      template: 'password-reset',
      to: identity.email,
      data: {
        displayName: identity.displayName,
        resetUrl: `${this.env.APP_PUBLIC_URL}/reset-password#token=${token}`,
        expiresInMinutes: RESET_TOKEN_MINUTES,
      },
    });
    this.cls
      .get('log')
      .info(
        { event: 'auth.password_reset_requested', identityId: identity.id },
        'password reset requested',
      );
  }

  /** Sets a new password from a reset link and signs out every session of the account. */
  async reset(token: string, newPassword: string): Promise<void> {
    const ip = this.cls.get('ip') ?? 'unknown';
    await this.rateLimiter.consume(`pwreset-use:ip:${ip}`, 20, 15 * 60);

    const record = await this.prisma.platform.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { identity: { select: { id: true, email: true, displayName: true, status: true } } },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt <= new Date() ||
      record.identity.status !== 'ACTIVE'
    ) {
      throw Problems.invalidToken();
    }
    assertAcceptablePassword(newPassword, record.identity.email);
    const passwordHash = await hashPassword(newPassword);

    await this.prisma.platform.$transaction(async (tx) => {
      // Single use, even under concurrent submissions of the same link.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw Problems.invalidToken();
      await tx.identityCredential.upsert({
        where: { identityId: record.identityId },
        create: { identityId: record.identityId, passwordHash },
        update: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.identity.update({
        where: { id: record.identityId },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    });

    await this.sessions.revokeAllForIdentity(record.identityId, 'password_reset');
    await this.notifications.sendEmail({
      template: 'password-changed',
      to: record.identity.email,
      data: { displayName: record.identity.displayName },
    });
    this.cls
      .get('log')
      .info({ event: 'auth.password_reset', identityId: record.identityId }, 'password reset');
  }

  /** Signed-in change. Keeps the current session, signs out all others. */
  async change(currentPassword: string, newPassword: string): Promise<void> {
    const identityId = this.cls.get('identityId')!;
    await this.rateLimiter.consume(`pwchange:${identityId}`, 5, 15 * 60);
    const identity = await this.prisma.platform.identity.findUniqueOrThrow({
      where: { id: identityId },
      include: { credential: true },
    });
    if (
      !identity.credential ||
      !(await verifyPassword(identity.credential.passwordHash, currentPassword))
    ) {
      throw Problems.validation([
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }
    assertAcceptablePassword(newPassword, identity.email);
    await this.prisma.platform.identityCredential.update({
      where: { identityId },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
    });
    await this.sessions.revokeAllForIdentity(
      identityId,
      'password_changed',
      this.cls.get('sessionId'),
    );
    await this.notifications.sendEmail({
      template: 'password-changed',
      to: identity.email,
      data: { displayName: identity.displayName },
    });
  }
}
