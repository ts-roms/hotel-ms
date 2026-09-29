import { Inject, Injectable } from '@nestjs/common';
import type { PaymentIntent } from '@hotel/contracts';
import { uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { toMinor } from '../../../common/money.js';
import { Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { ENV, type Env } from '../../../config/env.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { AuditService } from '../../audit/audit.service.js';
import { INTENT_TTL_MS, type IntentRow, notConfigured, toIntentDto } from './payment-dto.js';
import { PAYMENT_PROVIDERS, type PaymentProvider, type PaymentProviders } from './providers.js';

/**
 * Online payments (blueprint §15.2). A payment intent asks the provider for a hosted
 * checkout; the folio PAYMENT line is posted only when a verified webhook says the money
 * arrived (PaymentWebhooksService). Card holds and refunds have their own services.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviders,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The provider new payments and holds go to; 409 when online payments are off. */
  activeProvider(): PaymentProvider {
    const provider = this.env.PAYMENT_PROVIDER
      ? this.providers.get(this.env.PAYMENT_PROVIDER)
      : undefined;
    if (!provider) throw notConfigured();
    return provider;
  }

  /** The provider that handled an earlier payment, hold or refund, if still registered. */
  providerFor(code: string): PaymentProvider | undefined {
    return this.providers.get(code);
  }

  // ---- Intents -----------------------------------------------------------------------------

  private async createIntent(input: {
    folioId: string;
    amountMinor: number | null;
    source: 'STAFF' | 'GUEST';
    returnUrl: (intentId: string) => string;
  }): Promise<PaymentIntent> {
    const provider = this.activeProvider();
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
  async startCheckout(
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
}
