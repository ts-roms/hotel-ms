import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PmsModule } from '../pms/pms.module.js';
import { CashierService } from './cashier/cashier.service.js';
import { FolioDocumentsService } from './documents/folio-documents.service.js';
import { FinanceController } from './finance.controller.js';
import { FolioService } from './folio/folio.service.js';
import { GuestPaymentsController } from './payments/guest-payments.controller.js';
import { PaymentWebhooksController } from './payments/payment-webhooks.controller.js';
import { PaymentsService } from './payments/payments.service.js';
import { PAYMENT_PROVIDERS, type PaymentProvider, SandboxProvider } from './payments/providers.js';
import { SandboxGatewayController } from './payments/sandbox-gateway.controller.js';
import { FinanceReportsService } from './reports/finance-reports.service.js';
import { FinanceSettingsService } from './settings/finance-settings.service.js';

/**
 * Finance (blueprint §6.1, §15): folios (ledger), payments and refunds, cashiering,
 * invoices/receipts, finance settings and reports. Tax rules belong to Pricing (PmsModule).
 */
@Module({
  imports: [PmsModule, NotificationsModule],
  controllers: [
    FinanceController,
    GuestPaymentsController,
    PaymentWebhooksController,
    SandboxGatewayController,
  ],
  providers: [
    FolioService,
    PaymentsService,
    CashierService,
    FinanceSettingsService,
    FolioDocumentsService,
    FinanceReportsService,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (env: Env) =>
        new Map<string, PaymentProvider>(
          env.PAYMENT_SANDBOX_ENABLED ? [['sandbox', new SandboxProvider(env)]] : [],
        ),
      inject: [ENV],
    },
  ],
  exports: [FolioService, FinanceReportsService],
})
export class FinanceModule {}
