'use client';

import { Badge, Card, CardContent } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { Cake } from 'lucide-react';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';
import { formatMonth } from '@hotel/format';

export function Birthdays() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const birthdays = useQuery({ queryKey: ['birthdays', propertyId], queryFn: pms.birthdays });
  if (!birthdays.data?.length) return null;
  return (
    <Card className="animate-fade-in">
      <CardContent className="flex flex-wrap items-center gap-2 pt-5 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Cake className="size-4 text-primary" />
          {t('hr.birthdays')}
        </span>
        {birthdays.data.slice(0, 8).map((b) => (
          <Badge key={b.employeeId} variant="primary">
            {b.name} · {formatMonth(b.month)} {b.day}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
