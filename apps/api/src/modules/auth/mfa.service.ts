import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { MfaChallengeRequest, RecoveryCodes, TotpEnrollment } from '@hotel/contracts';
import { type Tx, verifyPassword } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/database.js';
import { NotificationsQueue } from '../../infrastructure/queue.js';
import { RateLimiter } from '../../infrastructure/redis.js';
import { SECRET_BOX, SecretBox } from '../../infrastructure/secret-box.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';
import { SessionService } from './session.service.js';

const RECOVERY_CODE_COUNT = 10;
// No 0/o/1/l/i: codes get read aloud and typed from paper.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function hashRecoveryCode(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/**
 * TOTP multi-factor authentication (ADR-0006). Secrets are encrypted at rest with the
 * identity id as associated data; codes cannot be replayed (last used step is stored).
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly rateLimiter: RateLimiter,
    private readonly notifications: NotificationsQueue,
    private readonly cls: ClsService<RequestContext>,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get identityId(): string {
    return this.cls.get('identityId')!;
  }

  /** Step 1: create a pending factor and show the secret once. */
  async startEnrollment(): Promise<TotpEnrollment> {
    const identity = await this.prisma.platform.identity.findUniqueOrThrow({
      where: { id: this.identityId },
      select: {
        email: true,
        mfaFactors: { where: { verifiedAt: { not: null } }, select: { id: true } },
      },
    });
    if (identity.mfaFactors.length > 0) {
      throw Problems.conflict(
        'Multi-factor authentication is already enabled. Disable it first to re-enroll.',
      );
    }
    const secret = generateTotpSecret();
    await this.prisma.platform.$transaction(async (tx) => {
      await tx.mfaFactor.deleteMany({ where: { identityId: this.identityId, verifiedAt: null } });
      await tx.mfaFactor.create({
        data: {
          identityId: this.identityId,
          type: 'TOTP',
          secretEncrypted: new Uint8Array(this.secretBox.encrypt(secret, this.identityId)),
        },
      });
    });
    return { secret, otpauthUri: totpUri(secret, identity.email, this.env.MFA_ISSUER) };
  }

  /**
   * Step 2: prove the authenticator works and re-enter the password. Activates the factor,
   * issues recovery codes, marks this session verified and signs out every other session
   * of the identity. The password check keeps someone holding only a session cookie from
   * attaching their own authenticator and unlocking sensitive permissions.
   */
  async confirmEnrollment(
    code: string,
    password: string,
  ): Promise<{ token: string; recoveryCodes: RecoveryCodes }> {
    await this.limitAttempts();
    const credential = await this.prisma.platform.identityCredential.findUnique({
      where: { identityId: this.identityId },
    });
    if (!credential || !(await verifyPassword(credential.passwordHash, password))) {
      throw Problems.validation([{ path: 'password', message: 'Password is incorrect' }]);
    }
    const pending = await this.prisma.platform.mfaFactor.findFirst({
      where: { identityId: this.identityId, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) throw Problems.conflict('Start enrollment first.');

    const step = verifyTotp(this.secretBox.decrypt(pending.secretEncrypted, this.identityId), code);
    if (step === null) throw Problems.invalidMfaCode();

    const recoveryCodes = await this.prisma.platform.$transaction(async (tx) => {
      await tx.mfaFactor.update({
        where: { id: pending.id },
        data: { verifiedAt: new Date(), lastUsedStep: step },
      });
      return this.replaceRecoveryCodes(tx);
    });

    const sessionId = this.cls.get('sessionId')!;
    const { token, tokenHash } = await this.sessions.markMfaVerified(sessionId);
    this.cls.set('sessionTokenHash', tokenHash);
    await this.sessions.revokeAllForIdentity(this.identityId, 'mfa_enabled', sessionId);
    await this.notifyIdentity('mfa-enabled');
    return { token, recoveryCodes: { recoveryCodes } };
  }

  /** Second step of sign-in. */
  async challenge(input: MfaChallengeRequest): Promise<{ token: string }> {
    await this.limitAttempts();
    await this.verifySecondFactor(input);
    const { token, tokenHash } = await this.sessions.markMfaVerified(this.cls.get('sessionId')!);
    this.cls.set('sessionTokenHash', tokenHash);
    return { token };
  }

  async disable(input: MfaChallengeRequest): Promise<void> {
    await this.limitAttempts();
    await this.verifySecondFactor(input);
    await this.prisma.platform.$transaction([
      this.prisma.platform.mfaFactor.deleteMany({ where: { identityId: this.identityId } }),
      this.prisma.platform.mfaRecoveryCode.deleteMany({ where: { identityId: this.identityId } }),
    ]);
    await this.notifyIdentity('mfa-disabled');
  }

  async regenerateRecoveryCodes(code: string): Promise<RecoveryCodes> {
    await this.limitAttempts();
    await this.verifySecondFactor({ code });
    const recoveryCodes = await this.prisma.platform.$transaction((tx) =>
      this.replaceRecoveryCodes(tx),
    );
    return { recoveryCodes };
  }

  private async verifySecondFactor(input: MfaChallengeRequest): Promise<void> {
    if ('code' in input) {
      const factor = await this.prisma.platform.mfaFactor.findFirst({
        where: { identityId: this.identityId, verifiedAt: { not: null } },
      });
      if (!factor) throw Problems.conflict('Multi-factor authentication is not enabled.');
      const step = verifyTotp(
        this.secretBox.decrypt(factor.secretEncrypted, this.identityId),
        input.code,
      );
      if (step === null) throw Problems.invalidMfaCode();
      // Atomic replay guard: a code (step) can be used once, even by concurrent requests.
      const claimed = await this.prisma.platform.mfaFactor.updateMany({
        where: { id: factor.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
        data: { lastUsedStep: step },
      });
      if (claimed.count !== 1) throw Problems.invalidMfaCode();
      return;
    }
    const used = await this.prisma.platform.mfaRecoveryCode.updateMany({
      where: {
        identityId: this.identityId,
        codeHash: hashRecoveryCode(input.recoveryCode),
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) throw Problems.invalidMfaCode();
    this.cls
      .get('log')
      .warn(
        { event: 'auth.recovery_code_used', identityId: this.identityId },
        'recovery code used',
      );
  }

  private async replaceRecoveryCodes(tx: Tx): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await tx.mfaRecoveryCode.deleteMany({ where: { identityId: this.identityId } });
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({
        identityId: this.identityId,
        codeHash: hashRecoveryCode(code),
      })),
    });
    return codes;
  }

  /** 6-digit codes are guessable without a tight limit: 5 tries per 5 minutes per identity. */
  private async limitAttempts(): Promise<void> {
    await this.rateLimiter.consume(`mfa:${this.identityId}`, 5, 5 * 60, { failClosed: true });
  }

  private async notifyIdentity(template: 'mfa-enabled' | 'mfa-disabled'): Promise<void> {
    const identity = await this.prisma.platform.identity.findUniqueOrThrow({
      where: { id: this.identityId },
      select: { email: true, displayName: true },
    });
    await this.notifications.sendEmail({
      template,
      to: identity.email,
      data: { displayName: identity.displayName },
    });
  }
}
