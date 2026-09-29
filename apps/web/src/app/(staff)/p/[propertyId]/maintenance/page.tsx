'use client';

import { Alert, Badge, Button, cn, EmptyState, PageHeader } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { enumLabel, statusLabel, statusVariant } from '@/lib/status';
import { MaintenanceDetail } from './_components/maintenance-detail';
import { MaintenanceReportForm } from './_components/maintenance-report-form';

const FILTERS = [
  { key: 'ACTIVE', label: 'mnt.active' },
  { key: 'MINE', label: 'mnt.mine' },
  { key: 'DONE', label: 'mnt.done' },
  { key: 'ALL', label: 'mnt.all' },
] as const;

/** Maintenance requests of the property (spec §32, ADR-0023). */
export default function MaintenancePage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('ACTIVE');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['maintenance', propertyId, filter],
    queryFn: () =>
      pms.maintenance(
        filter === 'MINE' ? { status: 'ACTIVE', assignedToMe: true } : { status: filter },
      ),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('mnt.title')} description={t('mnt.hint')} />
      <div className="flex flex-wrap gap-2">
        {FILTERS.filter((f) => f.key !== 'MINE' || can('maintenance.work')).map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? 'default' : 'outline'}
            onClick={() => setFilter(f.key)}
          >
            {t(f.label)}
          </Button>
        ))}
      </div>
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-2">
          {list.data?.length === 0 && <EmptyState icon={<Wrench />} title={t('mnt.none')} />}
          {list.data?.map((r) => (
            <Button
              key={r.id}
              type="button"
              variant="outline"
              onClick={() => setSelected(r.id)}
              className={cn(
                'h-auto flex-col items-stretch justify-start gap-1 whitespace-normal rounded-xl p-3 text-left font-normal text-foreground hover:bg-accent/40 hover:text-foreground active:scale-100',
                selected === r.id && 'border-primary hover:border-primary',
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{r.requestNo}</span>
                <Badge variant={statusVariant(r.priority)}>
                  {enumLabel('priority', r.priority)}
                </Badge>
                <Badge variant={statusVariant(r.status)} dot>
                  {statusLabel(r.status)}
                </Badge>
                {r.outOfOrder && !r.outOfOrder.released && (
                  <Badge variant="danger">{t('mnt.outOfOrder')}</Badge>
                )}
              </span>
              <span className="font-medium">{r.title}</span>
              <span className="text-xs text-muted-foreground">
                {r.roomNumber ? `${t('mnt.room')} ${r.roomNumber}` : r.location} ·{' '}
                {enumLabel('category', r.category)}
                {r.assignedName && ` · ${r.assignedName}`}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {selected && (
            <MaintenanceDetail
              propertyId={propertyId}
              requestId={selected}
              onClose={() => setSelected(null)}
            />
          )}
          {can('maintenance.report') && (
            <MaintenanceReportForm propertyId={propertyId} onCreated={setSelected} />
          )}
        </div>
      </div>
    </div>
  );
}
