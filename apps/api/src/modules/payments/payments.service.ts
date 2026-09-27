import { Inject, Injectable } from '@nestjs/common';
import type { PaymentIntent, PaymentSettings, Refund } from '@hotel/contracts';
import { type Prisma, type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { isUniqueViolation } from '../../common/db-errors.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { FolioService } from '../folio/folio.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { toMinor } from '../pms/pricing.js';
import { invalidState } from '../pms/reservations.service.js';
import { PAYMENT_SETTINGS_KEY, paymentSettingsInTx } from './holds.js';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type PaymentProviders,
  type ProviderEvent,
} from './providers.js';

const INTENT_TTL_MS = 60 * 60_000;

const notConfigured = () =>
  new ProblemException(
    409,
    'FEATURE_DISABLED',
    'Online payments are not set up',
    'Take the payment at the desk.',
  );

type IntentRow = Prisma.PaymentIntentGetPayload<object>;

function toIntentDto(i: IntentRow): PaymentIntent {
  return {
    id: i.id,
    kind: i.kind === 'HOLD' ? 'HOLD' : 'PAYMENT',
    folioId: i.folioId,
    reservationRoomId: i.reservationRoomId,
    capturedMinor: toMinor(i.capturedMinor),
    provider: i.provider,
    amountMinor: toMinor(i.amountMinor),
    currency: i.currency,
    status: i.status,
    checkoutUrl: i.status === 'PENDING' ? i.checkoutUrl : null,
    paymentId: i.paymentId,
    needsAttention: i.needsAttention,
    failureReason: i.failureReason,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

function toRefundDto(
  r: Prisma.RefundGetPayload<{ include: { payment: { select: { method: true } } } }>,
): Refund {
  return {
    id: r.id,
    paymentId: r.paymentId,
    amountMinor: toMinor(r.amountMinor),
    method: r.payment.method,
    status: r.status,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Online payments and refunds (blueprint §15.2). A payment intent asks the provider for a
 * hosted checkout; the folio PAYMENT line is posted only when a verified webhook says the
 * money arrived. Every webhook is stored first, and a redelivered event is a no-op.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly folios: FolioService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviders,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private provider(): PaymentProvider {
    const provider = this.env.PAYMENT_PROVIDER
      ? this.providers.get(this.env.PAYMENT_PROVIDER)
      : undefined;
    if (!provider) throw notConfigured();
    return provider;
  }

  // ---- Intents -----------------------------------------------------------------------------

  private async createIntent(input: {
    folioId: string;
    amountMinor: number | null;
    source: 'STAFF' | 'GUEST';
    returnUrl: (intentId: string) => string;
  }): Promise<PaymentIntent> {
    const provider = this.provider();
    const organizationId = this.cls.get('organizationId')!;
    const propertyId = this.cls.get('propertyId')!;
    const id = uuidv7();
    const intent = await this.db.run(async (tx) => {
      const folio = await tx.folio.findFirst({ where: { id: input.folioId, propertyId } });
      if (!folio) throw Problems.notFound('Folio');
      if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
      const amount = input.amountMinor !== null ? BigInt(input.amountMinor) : folio.balanceMinor;
      if (input.source === 'GUEST' && (amount <= 0n || amount > folio.balanceMinor)) {
        throw Problems.validation([
          { path: 'amountMinor', message: 'Pay up to the current balance' },
        ]);
      }
      const row = await tx.paymentIntent.create({
        data: {
          id,
          organizationId,
          propertyId,
          folioId: folio.id,
          provider: provider.code,
          amountMinor: amount,
          currency: folio.currency,
          returnUrl: input.returnUrl(id),
          source: input.source,
          createdBy: this.cls.get('identityId') ?? null,
          guestSessionId: this.cls.get('guest')?.sessionId ?? null,
          expiresAt: new Date(Date.now() + INTENT_TTL_MS),
        },
      });
      await this.audit.record(tx, {
        action: 'payment.intent_created',
        entityType: 'folio',
        entityId: folio.id,
        propertyId,
        after: { intentId: id, amountMinor: toMinor(amount), provider: provider.code },
      });
      return { row, folioNo: folio.folioNo };
    });
    return this.startCheckout(provider, intent.row, `Folio ${intent.folioNo}`, 'AUTOMATIC');
  }

  /** Asks the provider for the hosted page; outside any database transaction. */
  private async startCheckout(
    provider: PaymentProvider,
    row: IntentRow,
    description: string,
    capture: 'AUTOMATIC' | 'MANUAL',
  ): Promise<PaymentIntent> {
    const id = row.id;
    try {
      const checkout = await provider.createCheckout({
        intentId: id,
        capture,
        amountMinor: toMinor(row.amountMinor),
        currency: row.currency,
        description,
        returnUrl: row.returnUrl,
      });
      return toIntentDto(
        await this.db.run((tx) =>
          tx.paymentIntent.update({
            where: { id },
            data: { providerRef: checkout.reference, checkoutUrl: checkout.checkoutUrl },
          }),
        ),
      );
    } catch (error) {
      await this.db.run((tx) =>
        tx.paymentIntent.update({
          where: { id },
          data: {
            status: 'FAILED',
            failureReason: 'The payment provider could not start the checkout.',
          },
        }),
      );
      throw error;
    }
  }

  /** Staff: a payment link for any amount (e.g. a deposit) on a folio. */
  staffLink(propertyId: string, folioId: string, amountMinor: number): Promise<PaymentIntent> {
    return this.createIntent({
      folioId,
      amountMinor,
      source: 'STAFF',
      returnUrl: () => `${this.env.APP_PUBLIC_URL}/p/${propertyId}/folios/${folioId}`,
    });
  }

  /** Guest: pay (part of) the balance of their own stay folio. */
  async guestPay(amountMinor: number | undefined): Promise<PaymentIntent> {
    const guest = this.cls.get('guest')!;
    const folio = await this.db.run((tx) =>
      tx.folio.findFirst({
        where: { reservationRoomId: guest.reservationRoomId },
        select: { id: true },
      }),
    );
    if (!folio) throw invalidState('There is nothing to pay yet.');
    return this.createIntent({
      folioId: folio.id,
      amountMinor: amountMinor ?? null,
      source: 'GUEST',
      returnUrl: (id) => `${this.env.GUEST_PUBLIC_URL}/stay?payment=${id}`,
    });
  }

  /** A folio's payment intents, plus the card holds of its stay. */
  async intentsForFolio(folioId: string): Promise<PaymentIntent[]> {
    const propertyId = this.cls.get('propertyId')!;
    const rows = await this.db.run(async (tx) => {
      const folio = await tx.folio.findFirst({
        where: { id: folioId, propertyId },
        select: { reservationRoomId: true },
      });
      if (!folio) throw Problems.notFound('Folio');
      return tx.paymentIntent.findMany({
        where: {
          propertyId,
          OR: [
            { folioId },
            ...(folio.reservationRoomId
              ? [{ reservationRoomId: folio.reservationRoomId, kind: 'HOLD' }]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });
    return rows.map(toIntentDto);
  }

  async guestIntents(): Promise<PaymentIntent[]> {
    const guest = this.cls.get('guest')!;
    const rows = await this.db.run((tx) =>
      tx.paymentIntent.findMany({
        where: {
          source: 'GUEST',
          OR: [
            { folio: { reservationRoomId: guest.reservationRoomId } },
            { reservationRoomId: guest.reservationRoomId, kind: 'HOLD' },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    return rows.map(toIntentDto);
  }

  /** Sandbox checkout page: the intent behind a sandbox reference (no tenant context). */
  async findByReference(provider: string, reference: string): Promise<IntentRow | null> {
    return this.db.runWithPaymentRef(`${provider}:${reference}`, (tx) =>
      tx.paymentIntent.findFirst({ where: { provider, providerRef: reference } }),
    );
  }

  // ---- Webhooks ----------------------------------------------------------------------------

  /**
   * Verifies, stores and applies one provider event. Duplicates return 'duplicate'.
   * Processing errors are recorded and rethrown, so the provider retries later.
   */
  async handleWebhook(
    providerCode: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<'processed' | 'ignored' | 'duplicate'> {
    const provider = this.providers.get(providerCode);
    if (!provider) throw Problems.notFound('Payment provider');
    const event = provider.verifyWebhook(rawBody, headers);
    const paymentRef = `${provider.code}:${event.reference}`;

    const inbox = await this.db.runWithPaymentRef(paymentRef, async (tx) => {
      try {
        return await tx.webhookEvent.create({
          data: {
            provider: provider.code,
            eventId: event.eventId,
            eventType: event.type,
            signatureValid: true,
            payload: JSON.parse(rawBody.toString('utf8')) as Prisma.InputJsonValue,
            attempts: 1,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return null;
      }
    });
    let eventRowId: string;
    if (inbox) {
      eventRowId = inbox.id;
    } else {
      const existing = await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.findUniqueOrThrow({
          where: { provider_eventId: { provider: provider.code, eventId: event.eventId } },
        }),
      );
      if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') return 'duplicate';
      eventRowId = existing.id;
      await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.update({ where: { id: eventRowId }, data: { attempts: { increment: 1 } } }),
      );
    }

    try {
      const outcome = await this.apply(provider, event);
      await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.update({
          where: { id: eventRowId },
          data: {
            status: outcome === 'processed' ? 'PROCESSED' : 'IGNORED',
            processedAt: new Date(),
            lastError: null,
          },
        }),
      );
      return outcome;
    } catch (error) {
      await this.db.runWithPaymentRef(paymentRef, (tx) =>
        tx.webhookEvent.update({
          where: { id: eventRowId },
          data: {
            status: 'FAILED',
            lastError: error instanceof Error ? error.message.slice(0, 500) : 'error',
          },
        }),
      );
      throw error;
    }
  }

  private async apply(
    provider: PaymentProvider,
    event: ProviderEvent,
  ): Promise<'processed' | 'ignored'> {
    if (event.type === 'refund.succeeded' || event.type === 'refund.failed') {
      return this.applyRefundEvent(provider, event);
    }
    const intent = await this.findByReference(provider.code, event.reference);
    if (!intent) return 'ignored';

    // The tenant comes from the intent the verified reference resolved to.
    this.cls.set('organizationId', intent.organizationId);
    this.cls.set('propertyId', intent.propertyId);
    this.cls.set('system', true);

    return this.db.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_intents WHERE id = ${intent.id}::uuid FOR UPDATE`;
      const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      if (current.kind === 'HOLD') return this.applyHoldEvent(tx, current, event);
      if (event.type === 'payment.authorized') return 'ignored';
      if (current.status === 'SUCCEEDED' || current.status === 'FAILED') return 'ignored';

      if (event.type === 'payment.failed') {
        await tx.paymentIntent.update({
          where: { id: current.id },
          data: { status: 'FAILED', failureReason: event.failureReason ?? 'Declined' },
        });
        await this.outbox.enqueue(
          tx,
          'PaymentFailed',
          {
            paymentIntentId: current.id,
            folioId: current.folioId,
            reason: event.failureReason ?? 'Declined',
          },
          { propertyId: current.propertyId },
        );
        return 'processed';
      }

      // payment.succeeded: money was taken, even if the intent had expired meanwhile.
      if (
        BigInt(event.amountMinor) !== current.amountMinor ||
        event.currency !== current.currency
      ) {
        await tx.paymentIntent.update({
          where: { id: current.id },
          data: {
            status: 'SUCCEEDED',
            needsAttention: true,
            failureReason: `Provider reported ${event.amountMinor} ${event.currency}; expected ${toMinor(current.amountMinor)} ${current.currency}.`,
          },
        });
        return 'processed';
      }
      const folio = await tx.folio.findUniqueOrThrow({ where: { id: current.folioId! } });
      let paymentId: string | null = null;
      if (folio.status === 'OPEN') {
        paymentId = await this.folios.recordPaymentInTx(tx, folio.id, {
          method: event.method,
          amountMinor: event.amountMinor,
          reference: event.reference,
          provider: provider.code,
          intentId: current.id,
        });
      }
      await tx.paymentIntent.update({
        where: { id: current.id },
        data: {
          status: 'SUCCEEDED',
          paymentId,
          needsAttention: paymentId === null,
          failureReason:
            paymentId === null ? 'The folio was closed; apply this payment manually.' : null,
        },
      });
      await this.outbox.enqueue(
        tx,
        'PaymentSucceeded',
        {
          paymentIntentId: current.id,
          paymentId,
          folioId: folio.id,
          amountMinor: event.amountMinor,
        },
        { propertyId: current.propertyId },
      );
      return 'processed';
    });
  }

  /** A hold only moves PENDING → AUTHORIZED (or FAILED); capture and release are ours. */
  private async applyHoldEvent(
    tx: Tx,
    current: IntentRow,
    event: ProviderEvent,
  ): Promise<'processed' | 'ignored'> {
    if (current.status !== 'PENDING') return 'ignored';
    if (event.type === 'payment.failed') {
      await tx.paymentIntent.update({
        where: { id: current.id },
        data: { status: 'FAILED', failureReason: event.failureReason ?? 'Declined' },
      });
      await this.outbox.enqueue(
        tx,
        'PaymentFailed',
        { paymentIntentId: current.id, folioId: null, reason: event.failureReason ?? 'Declined' },
        { propertyId: current.propertyId },
      );
      return 'processed';
    }
    if (event.type !== 'payment.authorized') return 'ignored';
    if (BigInt(event.amountMinor) !== current.amountMinor || event.currency !== current.currency) {
      await tx.paymentIntent.update({
        where: { id: current.id },
        data: {
          status: 'FAILED',
          needsAttention: true,
          failureReason: `Provider authorized ${event.amountMinor} ${event.currency}; expected ${toMinor(current.amountMinor)} ${current.currency}.`,
        },
      });
      return 'processed';
    }
    await tx.paymentIntent.update({
      where: { id: current.id },
      data: { status: 'AUTHORIZED' },
    });
    await this.outbox.enqueue(
      tx,
      'HoldAuthorized',
      {
        paymentIntentId: current.id,
        reservationRoomId: current.reservationRoomId!,
        amountMinor: event.amountMinor,
      },
      { propertyId: current.propertyId },
    );
    return 'processed';
  }

  /** Completes a refund the provider left pending (ADR-0018). */
  private async applyRefundEvent(
    provider: PaymentProvider,
    event: ProviderEvent,
  ): Promise<'processed' | 'ignored'> {
    const refund = await this.db.runWithPaymentRef(`${provider.code}:${event.reference}`, (tx) =>
      tx.refund.findFirst({ where: { provider: provider.code, providerRef: event.reference } }),
    );
    if (!refund) return 'ignored';

    this.cls.set('organizationId', refund.organizationId);
    this.cls.set('propertyId', refund.propertyId);
    this.cls.set('system', true);

    return this.db.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refund.id}::uuid FOR UPDATE`;
      const current = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      if (current.status !== 'PENDING') return 'ignored';
      const failed = event.type === 'refund.failed';
      if (failed) {
        await tx.refund.update({
          where: { id: current.id },
          data: { status: 'FAILED', completedAt: new Date() },
        });
      } else {
        const folio = await tx.folio.findUniqueOrThrow({ where: { id: current.folioId } });
        // The money went back either way; a closed folio is left for finance to adjust.
        const lineId =
          folio.status === 'OPEN'
            ? await this.folios.postRefundLineInTx(tx, folio.id, {
                amountMinor: current.amountMinor,
                description: 'Refund (online)',
                reason: current.reason,
              })
            : null;
        await tx.refund.update({
          where: { id: current.id },
          data: { status: 'SUCCEEDED', folioLineId: lineId, completedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        action: failed ? 'payment.refund_failed' : 'payment.refund_completed',
        entityType: 'payment',
        entityId: current.paymentId,
        propertyId: current.propertyId,
        after: { refundId: current.id },
      });
      await this.outbox.enqueue(
        tx,
        'RefundIssued',
        {
          refundId: current.id,
          paymentId: current.paymentId,
          amountMinor: toMinor(current.amountMinor),
          status: failed ? 'FAILED' : 'SUCCEEDED',
        },
        { propertyId: current.propertyId },
      );
      return 'processed';
    });
  }

  // ---- Card holds (pre-authorization) ------------------------------------------------------

  async settings(propertyId: string): Promise<PaymentSettings> {
    return this.db.run((tx) => paymentSettingsInTx(tx, propertyId));
  }

  async updateSettings(propertyId: string, settings: PaymentSettings): Promise<PaymentSettings> {
    return this.db.run(async (tx) => {
      const before = await paymentSettingsInTx(tx, propertyId);
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
    const provider = this.provider();
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
      const { selfCheckInHoldMinor } = await paymentSettingsInTx(tx, line.propertyId);
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
    return this.startCheckout(
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
    const provider = this.providers.get(checked.intent.provider);
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
      const provider = this.providers.get(intent.provider);
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

  // ---- Refunds -----------------------------------------------------------------------------

  /**
   * Refunds up to what was captured minus earlier refunds, under a row lock on the payment
   * (§15.2). Gateway payments are refunded through the provider; desk payments are
   * recorded (cash from the cashier's open shift).
   */
  async refund(
    propertyId: string,
    paymentId: string,
    amountMinor: number,
    reason: string,
  ): Promise<Refund> {
    const organizationId = this.cls.get('organizationId')!;
    const include = { payment: { select: { method: true } } } as const;
    const created = await this.db.run(async (tx) => {
      // payments are append-only (no UPDATE grant, so no FOR UPDATE): an advisory lock
      // serializes refunds of one payment instead.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`refund:${paymentId}`}, 0))`;
      const payment = await tx.payment.findFirst({ where: { id: paymentId, propertyId } });
      if (!payment) throw Problems.notFound('Payment');
      const refunded = await tx.refund.aggregate({
        where: { paymentId, status: { not: 'FAILED' } },
        _sum: { amountMinor: true },
      });
      const remaining = payment.amountMinor - (refunded._sum.amountMinor ?? 0n);
      if (BigInt(amountMinor) > remaining) {
        throw new ProblemException(
          409,
          'REFUND_EXCEEDS_PAYMENT',
          'Refund too large',
          `At most ${toMinor(remaining)} can still be refunded on this payment.`,
        );
      }
      const folio = await tx.folio.findUniqueOrThrow({ where: { id: payment.folioId } });
      if (folio.status !== 'OPEN')
        throw invalidState('The folio is closed. Refunds after check-out are handled by finance.');
      let cashierShiftId: string | null = null;
      if (payment.method === 'CASH' && !payment.provider) {
        const shift = await this.folios.openShiftInTx(tx);
        if (!shift) {
          throw new ProblemException(
            409,
            'CASHIER_SHIFT_REQUIRED',
            'Open a cashier shift',
            'Cash refunds come out of your cashier shift.',
          );
        }
        cashierShiftId = shift.id;
      }
      const viaProvider = payment.provider !== null;
      const refund = await tx.refund.create({
        data: {
          organizationId,
          propertyId,
          paymentId,
          folioId: folio.id,
          amountMinor: BigInt(amountMinor),
          reason,
          status: viaProvider ? 'PENDING' : 'SUCCEEDED',
          provider: payment.provider,
          cashierShiftId,
          createdBy: this.cls.get('identityId') ?? null,
          completedAt: viaProvider ? null : new Date(),
        },
      });
      if (!viaProvider) {
        const lineId = await this.folios.postRefundLineInTx(tx, folio.id, {
          amountMinor: BigInt(amountMinor),
          description: `Refund (${payment.method.replace('_', ' ').toLowerCase()})`,
          reason,
        });
        await tx.refund.update({ where: { id: refund.id }, data: { folioLineId: lineId } });
      }
      await this.audit.record(tx, {
        action: 'payment.refunded',
        entityType: 'payment',
        entityId: paymentId,
        propertyId,
        after: { refundId: refund.id, amountMinor, reason },
      });
      return { refund, payment };
    });

    if (created.payment.provider) {
      const provider = this.providers.get(created.payment.provider);
      let result: { reference: string; status: 'SUCCEEDED' | 'PENDING' } | null = null;
      try {
        if (!provider) throw new Error(`Provider ${created.payment.provider} is not configured`);
        result = await provider.refund({
          paymentReference: created.payment.reference ?? '',
          amountMinor,
          currency: created.payment.currency,
        });
      } catch {
        result = null;
      }
      await this.db.run(async (tx) => {
        if (!result) {
          await tx.refund.update({
            where: { id: created.refund.id },
            data: { status: 'FAILED', completedAt: new Date() },
          });
          return;
        }
        if (result.status === 'SUCCEEDED') {
          const lineId = await this.folios.postRefundLineInTx(tx, created.refund.folioId, {
            amountMinor: BigInt(amountMinor),
            description: 'Refund (online)',
            reason,
          });
          await tx.refund.update({
            where: { id: created.refund.id },
            data: {
              status: 'SUCCEEDED',
              providerRef: result.reference,
              folioLineId: lineId,
              completedAt: new Date(),
            },
          });
        } else {
          await tx.refund.update({
            where: { id: created.refund.id },
            data: { providerRef: result.reference },
          });
        }
      });
    }
    const row = await this.db.run(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: created.refund.id },
        include,
      });
      await this.outbox.enqueue(
        tx,
        'RefundIssued',
        { refundId: refund.id, paymentId, amountMinor, status: refund.status },
        { propertyId },
      );
      return refund;
    });
    if (row.status === 'FAILED') {
      throw new ProblemException(
        502,
        'INTERNAL_ERROR',
        'Refund failed',
        'The payment provider refused the refund.',
      );
    }
    return toRefundDto(row);
  }

  async refunds(propertyId: string, paymentId: string): Promise<Refund[]> {
    const rows = await this.db.run((tx: Tx) =>
      tx.refund.findMany({
        where: { paymentId, propertyId },
        include: { payment: { select: { method: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(toRefundDto);
  }
}
