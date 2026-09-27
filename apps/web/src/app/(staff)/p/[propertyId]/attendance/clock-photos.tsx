'use client';

import { Card, CardContent, CardHeader, CardTitle, Button } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { clock } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { statusLabel } from '@/lib/status';

/**
 * Time clock punches with their selfies (ADR-0022). A photo loads only when asked for:
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="size-4 text-primary" />
          {t('clock.photos')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {photos.data.length === 0 && <p className="text-muted-foreground">{t('clock.none')}</p>}
        {photos.data.map((p) => (
          <div key={p.punchId} className="flex flex-col gap-2 border-t pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-mono text-xs text-muted-foreground">{p.employeeNo}</span>{' '}
                {p.employeeName} · {statusLabel(p.type)} ·{' '}
                {formatDate(new Date(p.at).toLocaleDateString('en-CA'))} {clock(p.at)}
                {p.deviceName && <span className="text-muted-foreground"> · {p.deviceName}</span>}
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
                alt={`${p.employeeName}, ${statusLabel(p.type)}`}
                className="max-h-64 self-start rounded-lg border"
              />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
