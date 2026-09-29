'use client';

import { type GuestStay } from '@hotel/contracts';
import { formatDate } from '@hotel/format';
import { BedDouble, CalendarDays, DoorOpen, Users } from 'lucide-react';
import { type ReactNode } from 'react';
import { t } from '@/lib/i18n';

export function StayOverview({ stay: s }: { stay: GuestStay }) {
  const guests = [
    t(s.stay.adults === 1 ? 'stay.adults.one' : 'stay.adults.other', { count: s.stay.adults }),
    s.stay.children > 0 &&
      t(s.stay.children === 1 ? 'stay.children.one' : 'stay.children.other', {
        count: s.stay.children,
      }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="guest-hero relative overflow-hidden rounded-2xl p-6 shadow-xl shadow-primary/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm opacity-80">{s.property.name}</span>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('stay.hello', { name: s.guest.firstName })}
          </h1>
        </div>
        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur">
          {t(`stay.status.${s.stay.status}`)}
        </span>
      </div>

      {s.stay.roomNumber && (
        <div className="mt-5 flex items-center gap-3">
          <DoorOpen className="size-6 opacity-80" />
          <span className="text-3xl font-semibold tracking-tight">
            {t('stay.room', { number: s.stay.roomNumber })}
          </span>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <HeroTile icon={<CalendarDays />} label={t('stay.checkIn')}>
          {formatDate(s.stay.arrivalDate)}
          <span className="block text-xs opacity-75">
            {t('stay.checkInFrom', { time: s.property.checkInTime })}
          </span>
        </HeroTile>
        <HeroTile icon={<CalendarDays />} label={t('stay.checkOut')}>
          {formatDate(s.stay.departureDate)}
          <span className="block text-xs opacity-75">
            {t('stay.checkOutBy', { time: s.property.checkOutTime })}
          </span>
        </HeroTile>
        <HeroTile icon={<BedDouble />} label={t('stay.roomType')}>
          {s.stay.roomTypeName}
        </HeroTile>
        <HeroTile icon={<Users />} label={t('stay.guests')}>
          {guests}
        </HeroTile>
      </div>

      <p className="mt-4 font-mono text-xs opacity-75">
        {t('stay.booking', { number: s.confirmationNo })}
      </p>
    </section>
  );
}

function HeroTile({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white/12 p-3 backdrop-blur">
      <span className="flex items-center gap-1.5 text-xs opacity-75 [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="mt-0.5 block font-medium">{children}</span>
    </div>
  );
}
