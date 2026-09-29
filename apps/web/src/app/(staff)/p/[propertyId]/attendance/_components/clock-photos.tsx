'use client';

import { formatDate, localDate } from '@hotel/format';
import { Button, CardContent, SectionCard } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { clock, PUNCH_LABEL } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';

/**
 * Punches with their selfies, from the web and time clocks (ADR-0022). A photo loads only when asked for:
 * every view is audited.
 */
export function ClockPhotos({
  propertyId,
  from,
  to,
}: {
  propertyId: string;
  from: string;
  to: string;
}) {
  const pms = usePms(propertyId);
  const photos = useQuery({
    queryKey: ['clock-photos', propertyId, from, to],
    queryFn: () => pms.clockPhotos(from, to),
  });
  const [open, setOpen] = useState<string | null>(null);
  if (!photos.data) return null;
  return (
    <SectionCard icon={Camera} title={t('clock.photos')}>
      <CardContent className="flex flex-col gap-2 text-sm">
        {photos.data.length === 0 && <p className="text-muted-foreground">{t('clock.none')}</p>}
        {photos.data.map((p) => (
          <div key={p.punchId} className="flex flex-col gap-2 border-t pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-mono text-xs text-muted-foreground">{p.employeeNo}</span>{' '}
                {p.employeeName} · {t(PUNCH_LABEL[p.type])} · {formatDate(localDate(p.at))}{' '}
                {clock(p.at)}
                <span className="text-muted-foreground">
                  {' '}
                  · {p.source === 'WEB' ? t('clock.web') : (p.deviceName ?? t('dev.timeClock'))}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpen(open === p.punchId ? null : p.punchId)}
              >
                {open === p.punchId ? t('clock.hide') : t('clock.view')}
              </Button>
            </div>
            {open === p.punchId && (
              <img
                src={pms.clockPhotoUrl(p.punchId)}
                alt={`${p.employeeName}, ${t(PUNCH_LABEL[p.type])}`}
                className="max-h-64 self-start rounded-lg border"
              />
            )}
          </div>
        ))}
      </CardContent>
    </SectionCard>
  );
}
