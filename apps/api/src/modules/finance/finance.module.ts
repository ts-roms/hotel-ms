import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { CashierController } from './cashier/cashier.controller.js';
import { CashierService } from './cashier/cashier.service.js';
import { FolioDocumentsController } from './documents/folio-documents.controller.js';
import { FolioDocumentsService } from './documents/folio-documents.service.js';
import { FolioDiscountsService } from './folio/folio-discounts.service.js';
import { FolioRoutingService } from './folio/folio-routing.service.js';
import { FolioController } from './folio/folio.controller.js';
import { FolioService } from './folio/folio.service.js';
import { CardHoldsService } from './payments/card-holds.service.js';
import { GuestPaymentsController } from './payments/guest-payments.controller.js';
import { PaymentWebhooksController } from './payments/payment-webhooks.controller.js';
import { PaymentWebhooksService } from './payments/payment-webhooks.service.js';
import { PaymentsController } from './payments/payments.controller.js';
import { PaymentsService } from './payments/payments.service.js';
import { PaymongoProvider } from './payments/paymongo.provider.js';
import { PAYMENT_PROVIDERS, type PaymentProvider } from './payments/providers.js';
import { RefundsService } from './payments/refunds.service.js';
import { SandboxGatewayController } from './payments/sandbox-gateway.controller.js';
import { SandboxProvider } from './payments/sandbox.provider.js';
import { FinanceReportsController } from './reports/finance-reports.controller.js';
import { FinanceReportsService } from './reports/finance-reports.service.js';
import { FinanceSettingsController } from './settings/finance-settings.controller.js';
import { FinanceSettingsService } from './settings/finance-settings.service.js';

/**
 * Finance (blueprint §6.1, §15): folios (ledger), payments and refunds, cashiering,
 * invoices/receipts, finance settings and reports. Tax rules belong to Pricing (PmsModule).
 */
@Module({
  imports: [PmsModule, NotificationsModule],
  controllers: [
    FolioController,
    PaymentsController,
    FinanceSettingsController,
    FolioDocumentsController,
    CashierController,
    FinanceReportsController,
    GuestPaymentsController,
    PaymentWebhooksController,
    SandboxGatewayController,
  ],
  providers: [
    FolioService,
    FolioDiscountsService,
    FolioRoutingService,
    PaymentsService,
    PaymentWebhooksService,
    CardHoldsService,
    RefundsService,
    CashierService,
    FinanceSettingsService,
    FolioDocumentsService,
    FinanceReportsService,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (env: Env) => {
        const providers = new Map<string, PaymentProvider>();
        if (env.PAYMENT_SANDBOX_ENABLED) providers.set('sandbox', new SandboxProvider(env));
        // Registered whenever configured, so webhooks and refunds of earlier PayMongo
        // payments keep working if PAYMENT_PROVIDER changes.
        if (env.PAYMONGO_SECRET_KEY && env.PAYMONGO_WEBHOOK_SECRET) {
          providers.set(
            'paymongo',
            new PaymongoProvider({
              secretKey: env.PAYMONGO_SECRET_KEY,
              webhookSecret: env.PAYMONGO_WEBHOOK_SECRET,
              methods: env.PAYMONGO_PAYMENT_METHODS,
              apiBase: env.PAYMONGO_API_BASE,
            }),
          );
        }
        return providers;
      },
      inject: [ENV],
    },
  ],
  exports: [FolioService, CardHoldsService, FinanceReportsService],
})
export class FinanceModule {}
