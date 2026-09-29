import { Inject, Injectable } from '@nestjs/common';
import type { PaymentIntent, PaymentSettings } from '@hotel/contracts';
import { type Prisma, type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { toMinor } from '../../../common/money.js';
import { Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { ENV, type Env } from '../../../config/env.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { FolioService } from '../folio/folio.service.js';
import { INTENT_TTL_MS, type IntentRow, notConfigured, toIntentDto } from './payment-dto.js';
import { PaymentsService } from './payments.service.js';

/** property_settings key of the payment settings. */
const PAYMENT_SETTINGS_KEY = 'payments';

const DEFAULT_SETTINGS: PaymentSettings = { selfCheckInHoldMinor: 0 };

/**
 * Card holds (pre-authorization) for guest self check-in, and the property's payment
 * settings that ask for them. Staff capture a hold onto the folio or release it.
 */
@Injectable()
export class CardHoldsService {
  constructor(
    private readonly db: TenantDb,
    private readonly payments: PaymentsService,
    private readonly folios: FolioService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The property's payment settings (property_settings key "payments"). */
  async settingsInTx(tx: Tx, propertyId: string): Promise<PaymentSettings> {
    const row = await tx.propertySetting.findFirst({
      where: { propertyId, key: PAYMENT_SETTINGS_KEY },
    });
    const value = (row?.value ?? {}) as Partial<PaymentSettings>;
    return {
      selfCheckInHoldMinor:
        typeof value.selfCheckInHoldMinor === 'number'
          ? value.selfCheckInHoldMinor
          : DEFAULT_SETTINGS.selfCheckInHoldMinor,
    };
  }

  /**
   * Card hold needed before a guest checks themselves in: the property's configured amount
   * (0 = none), and whether an authorized hold of at least that amount is in place.
   */
  async cardHoldStateInTx(
    tx: Tx,
    propertyId: string,
    reservationRoomId: string,
  ): Promise<{ requiredMinor: bigint; authorized: boolean }> {
    const { selfCheckInHoldMinor } = await this.settingsInTx(tx, propertyId);
    const requiredMinor = BigInt(selfCheckInHoldMinor);
    if (requiredMinor === 0n) return { requiredMinor, authorized: true };
    const hold = await tx.paymentIntent.findFirst({
      where: {
        reservationRoomId,
        kind: 'HOLD',
        status: 'AUTHORIZED',
        amountMinor: { gte: requiredMinor },
      },
      select: { id: true },
    });
    return { requiredMinor, authorized: hold !== null };
  }

  async settings(propertyId: string): Promise<PaymentSettings> {
    return this.db.run((tx) => this.settingsInTx(tx, propertyId));
  }

  async updateSettings(propertyId: string, settings: PaymentSettings): Promise<PaymentSettings> {
    return this.db.run(async (tx) => {
      const before = await this.settingsInTx(tx, propertyId);
      const organizationId = this.cls.get('organizationId')!;
      const updatedBy = this.cls.get('identityId') ?? null;
      const value = { ...settings } as Prisma.InputJsonValue;
      await tx.propertySetting.upsert({
        where: {
          organizationId_propertyId_key: { organizationId, propertyId, key: PAYMENT_SETTINGS_KEY },
        },
        create: { organizationId, propertyId, key: PAYMENT_SETTINGS_KEY, value, updatedBy },
        update: { value, updatedBy },
      });
      await this.audit.record(tx, {
        action: 'property.payment_settings_changed',
        entityType: 'property',
        entityId: propertyId,
        propertyId,
        before,
        after: settings,
      });
      return settings;
    });
  }

  /**
   * Guest: authorize a card hold for self check-in. Reuses an authorized hold, or a
   * pending one still open at the provider, so a retried tap never places two holds.
   */
  async guestHold(): Promise<PaymentIntent> {
    const provider = this.payments.activeProvider();
    const guest = this.cls.get('guest')!;
    const organizationId = this.cls.get('organizationId')!;
    const id = uuidv7();
    const result = await this.db.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hold:${guest.reservationRoomId}`}, 0))`;
      const line = await tx.reservationRoom.findUniqueOrThrow({
        where: { id: guest.reservationRoomId },
        include: { reservation: { select: { currency: true, confirmationNo: true } } },
      });
      if (line.status !== 'RESERVED')
        throw invalidState('A card hold is only needed before check-in.');
      const { selfCheckInHoldMinor } = await this.settingsInTx(tx, line.propertyId);
      if (selfCheckInHoldMinor === 0) throw invalidState('No card hold is needed for this stay.');
      const existing = await tx.paymentIntent.findFirst({
        where: {
          reservationRoomId: line.id,
          kind: 'HOLD',
          amountMinor: { gte: BigInt(selfCheckInHoldMinor) },
          OR: [
            { status: 'AUTHORIZED' },
            { status: 'PENDING', providerRef: { not: null }, expiresAt: { gt: new Date() } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { existing, row: null, confirmationNo: '' };
      const row = await tx.paymentIntent.create({
        data: {
          id,
          organizationId,
          propertyId: line.propertyId,
          kind: 'HOLD',
          reservationRoomId: line.id,
          provider: provider.code,
          amountMinor: BigInt(selfCheckInHoldMinor),
          currency: line.reservation.currency,
          returnUrl: `${this.env.GUEST_PUBLIC_URL}/stay?hold=${id}`,
          source: 'GUEST',
          guestSessionId: guest.sessionId,
          expiresAt: new Date(Date.now() + INTENT_TTL_MS),
        },
      });
      await this.audit.record(tx, {
        action: 'payment.hold_requested',
        entityType: 'reservation',
        entityId: line.reservationId,
        propertyId: line.propertyId,
        after: { intentId: id, amountMinor: selfCheckInHoldMinor, provider: provider.code },
      });
      return { existing: null, row, confirmationNo: line.reservation.confirmationNo };
    });
    if (result.existing) return toIntentDto(result.existing);
    return this.payments.startCheckout(
      provider,
      result.row!,
      `Card hold, booking ${result.confirmationNo}`,
      'MANUAL',
    );
  }

  private async lockHold(tx: Tx, propertyId: string, intentId: string): Promise<IntentRow> {
    await tx.$queryRaw`SELECT id FROM payment_intents WHERE id = ${intentId}::uuid FOR UPDATE`;
    const intent = await tx.paymentIntent.findFirst({
      where: { id: intentId, propertyId, kind: 'HOLD' },
    });
    if (!intent) throw Problems.notFound('Card hold');
    return intent;
  }

  /**
   * Staff: captures (part of) an authorized hold onto the stay's open folio, typically at
   * check-out. The provider releases whatever is not captured.
   */
  async captureHold(
    propertyId: string,
    intentId: string,
    amountMinor: number,
  ): Promise<PaymentIntent> {
    const checked = await this.db.run(async (tx) => {
      const intent = await this.lockHold(tx, propertyId, intentId);
      if (intent.status !== 'AUTHORIZED')
        throw invalidState('Only an authorized hold can be captured.');
      if (BigInt(amountMinor) > intent.amountMinor) {
        throw Problems.validation([
          { path: 'amountMinor', message: `At most ${toMinor(intent.amountMinor)} is authorized` },
        ]);
      }
      const folio = await tx.folio.findFirst({
        where: { reservationRoomId: intent.reservationRoomId, propertyId, status: 'OPEN' },
        orderBy: { openedAt: 'asc' },
      });
      if (!folio) throw invalidState('The stay has no open folio to capture onto.');
      return { intent, folioId: folio.id };
    });
    const provider = this.payments.providerFor(checked.intent.provider);
    if (!provider) throw notConfigured();
    await provider.capture({
      reference: checked.intent.providerRef ?? '',
      amountMinor,
      currency: checked.intent.currency,
    });
    return this.db.run(async (tx) => {
      const intent = await this.lockHold(tx, propertyId, intentId);
      if (intent.status !== 'AUTHORIZED') throw invalidState('The hold was already settled.');
      const paymentId = await this.folios.recordPaymentInTx(tx, checked.folioId, {
        method: 'CARD',
        amountMinor,
        reference: intent.providerRef,
        provider: intent.provider,
        intentId: intent.id,
      });
      const row = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'SUCCEEDED',
          folioId: checked.folioId,
          paymentId,
          capturedMinor: BigInt(amountMinor),
        },
      });
      await this.audit.record(tx, {
        action: 'payment.hold_captured',
        entityType: 'folio',
        entityId: checked.folioId,
        propertyId,
        after: { intentId, amountMinor, authorizedMinor: toMinor(intent.amountMinor) },
      });
      await this.outbox.enqueue(
        tx,
        'HoldCaptured',
        { paymentIntentId: intent.id, paymentId, amountMinor },
        { propertyId },
      );
      return toIntentDto(row);
    });
  }

  /** Staff: releases a hold without capturing (e.g. the guest paid another way). */
  async releaseHold(propertyId: string, intentId: string): Promise<PaymentIntent> {
    const settled = () => invalidState('The hold is already settled.');
    const intent = await this.db.run(async (tx) => {
      const intent = await this.lockHold(tx, propertyId, intentId);
      if (intent.status !== 'AUTHORIZED' && intent.status !== 'PENDING') throw settled();
      return intent;
    });
    if (intent.status === 'AUTHORIZED') {
      const provider = this.payments.providerFor(intent.provider);
      if (!provider) throw notConfigured();
      await provider.release({ reference: intent.providerRef ?? '' });
    }
    return this.db.run(async (tx) => {
      const current = await this.lockHold(tx, propertyId, intentId);
      if (current.status !== 'AUTHORIZED' && current.status !== 'PENDING') throw settled();
      const row = await tx.paymentIntent.update({
        where: { id: intentId },
        data: { status: 'CANCELLED' },
      });
      await this.audit.record(tx, {
        action: 'payment.hold_released',
        entityType: 'reservation_room',
        entityId: current.reservationRoomId ?? intentId,
        propertyId,
        after: { intentId },
      });
      await this.outbox.enqueue(tx, 'HoldReleased', { paymentIntentId: intentId }, { propertyId });
      return toIntentDto(row);
    });
  }
}
