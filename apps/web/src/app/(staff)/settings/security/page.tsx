'use client';

import { PageHeader } from '@hotel/ui';
import { t } from '@/lib/i18n';
import { ChangePasswordCard } from './_components/change-password-card';
import { KioskPinCard } from './_components/kiosk-pin-card';
import { MfaCard } from './_components/mfa-card';

export default function SecurityPage() {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader title={t('security.title')} />
      <div className="stagger flex flex-col gap-6">
        <MfaCard />
        <ChangePasswordCard />
        <KioskPinCard />
      </div>
    </div>
  );
}
