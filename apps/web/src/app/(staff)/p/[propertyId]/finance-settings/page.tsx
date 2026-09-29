'use client';

import { DocumentTitle } from '@hotel/ui';
import { t } from '@/lib/i18n';
import { useCan, usePropertyId } from '@/lib/property';
import { DiscountProfiles } from './_components/discount-profiles';
import { ExchangeRates } from './_components/exchange-rates';
import { HoldSettings } from './_components/hold-settings';

/** Exchange rates, statutory discount profiles and the self check-in card hold (ADR-0018). */
export default function FinanceSettingsPage() {
  const propertyId = usePropertyId();
  const can = useCan();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <DocumentTitle title={t('nav.financeSettings')} />
      <h1 className="text-xl font-semibold">{t('nav.financeSettings')}</h1>
      <ExchangeRates propertyId={propertyId} canManage={can('exchange_rate.manage')} />
      <DiscountProfiles propertyId={propertyId} canManage={can('tax.manage')} />
      <HoldSettings propertyId={propertyId} canManage={can('property.settings.manage')} />
    </div>
  );
}
