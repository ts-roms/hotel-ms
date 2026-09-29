'use client';

import { ApiError } from '@hotel/api-client';
import { type SelfCheckInResult } from '@hotel/contracts';
import { Alert, buttonVariants, DocumentTitle } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { BrandMark } from '@/components/guest-shell';
import { api, errorMessage, rememberStay } from '@/lib/api';
import { t } from '@/lib/i18n';
import { CheckoutRequest } from './_components/checkout-request';
import { ContactFooter } from './_components/contact-footer';
import { GuestBill } from './_components/guest-bill';
import { HotelEvents } from './_components/hotel-events';
import { HotelInfo } from './_components/hotel-info';
import { IdUpload } from './_components/id-upload';
import { Notifications } from './_components/notifications';
import { PreCheckIn } from './_components/pre-check-in';
import { RoomService } from './_components/room-service';
import { RoomAccess, SelfCheckIn } from './_components/self-check-in';
import { ServiceRequests } from './_components/service-requests';
import { StayOverview } from './_components/stay-overview';
import { StayShell, StaySkeleton } from './_components/stay-shell';
import { Verification } from './_components/verification';

function useStay() {
  return useQuery({
    queryKey: ['stay'],
    queryFn: () => api.stay().then(rememberStay),
    retry: false,
  });
}

export default function StayPage() {
  const stay = useStay();
  // Kept here: after check-in the stay refreshes and the check-in card goes away, but the
  // key instructions must stay on screen.
  const [checkedIn, setCheckedIn] = useState<SelfCheckInResult | null>(null);

  if (stay.isPending) {
    return (
      <StayShell>
        <StaySkeleton />
      </StayShell>
    );
  }
  if (stay.isError || !stay.data) {
    // No data and no error: signed out on this device just now.
    const signedOut = !stay.error || (stay.error instanceof ApiError && stay.error.status === 401);
    return (
      <StayShell>
        <div className="flex flex-col items-center gap-6 pt-16">
          <BrandMark />
          <Alert className="w-full">
            {signedOut ? t('stay.signedOut') : errorMessage(stay.error)}
          </Alert>
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>
            {t('stay.howToGetLink')}
          </Link>
        </div>
      </StayShell>
    );
  }
  const s = stay.data;
  return (
    <StayShell>
      <DocumentTitle title={s.property.name} />
      <div className="stagger flex flex-col gap-4">
        <StayOverview stay={s} />
        {s.verified && <Notifications unread={s.unreadNotifications} />}
        {!s.verified && <Verification stay={s} />}
        {s.verified && (s.stay.status === 'RESERVED' || s.stay.status === 'IN_HOUSE') && (
          <IdUpload stay={s} />
        )}
        {s.verified && s.stay.status === 'RESERVED' && <PreCheckIn stay={s} />}
        {checkedIn && <RoomAccess result={checkedIn} />}
        {s.selfCheckInAvailable && !checkedIn && (
          <SelfCheckIn stay={s} onCheckedIn={setCheckedIn} />
        )}
        {s.verified && s.stay.status === 'IN_HOUSE' && <RoomService />}
        {s.verified && s.stay.status === 'IN_HOUSE' && <ServiceRequests />}
        {s.verified && (s.stay.status === 'IN_HOUSE' || s.stay.status === 'CHECKED_OUT') && (
          <GuestBill />
        )}
        {s.verified && s.stay.status === 'IN_HOUSE' && <CheckoutRequest stay={s} />}
        {(s.stay.status === 'RESERVED' || s.stay.status === 'IN_HOUSE') && (
          <HotelEvents timeZone={s.property.timezone} />
        )}
        <HotelInfo stay={s} />
        <ContactFooter stay={s} />
      </div>
    </StayShell>
  );
}
