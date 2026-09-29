'use client';

import { type HotelEvent } from '@hotel/contracts';
import { addDays, toZoned } from '@hotel/format';
import { t } from '@/lib/i18n';
import { statusLabel } from '@/lib/status';

export function EventSummary({ event: e, timeZone }: { event: HotelEvent; timeZone: string }) {
  const start = toZoned(e.startsAt, timeZone);
  const end = toZoned(e.endsAt, timeZone);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {e.status === 'CANCELLED' && <p className="text-destructive">{t('cal.cancelled')}</p>}
      <p>
        {statusLabel(e.category)}
        {e.location && ` · ${e.location}`}
      </p>
      <p className="tabular-nums">
        {e.allDay
          ? `${start.date} → ${addDays(end.date, -1)}`
          : `${start.date} ${start.time} – ${end.date === start.date ? '' : `${end.date} `}${end.time}`}
      </p>
      {e.description && <p className="whitespace-pre-wrap">{e.description}</p>}
      {e.organizerName && (
        <p className="text-muted-foreground">
          {t('cal.organizer')}: {e.organizerName}
        </p>
      )}
      {e.participants.length > 0 && (
        <p className="text-muted-foreground">
          {t('cal.participants')}: {e.participants.map((p) => p.name).join(', ')}
        </p>
      )}
    </div>
  );
}
