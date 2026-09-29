'use client';

import { type ServiceRequest, type ServiceRequestUpdate, type StaffRef } from '@hotel/contracts';
import { formatTime } from '@hotel/format';
import { Badge, Button, Card, CardContent, cn, NativeSelect } from '@hotel/ui';
import { Check, Star } from 'lucide-react';
import { t } from '@/lib/i18n';
import { enumLabel, statusLabel, statusVariant } from '@/lib/status';

const PRIORITY_STRIPE: Record<ServiceRequest['priority'], string> = {
  LOW: 'before:bg-border',
  NORMAL: 'before:bg-primary',
  HIGH: 'before:bg-warning',
  URGENT: 'before:bg-destructive',
};

/** One request in the queue, with assignment and status actions for staff who can update. */
export function ServiceRequestCard({
  request: r,
  timeZone,
  canUpdate,
  canReportMaintenance,
  assignees,
  updatePending,
  running,
  onUpdate,
  toMaintenancePending,
  toMaintenanceRunning,
  onToMaintenance,
}: {
  request: ServiceRequest;
  timeZone: string | undefined;
  canUpdate: boolean;
  canReportMaintenance: boolean;
  assignees: StaffRef[] | undefined;
  /** Any update is in flight. */
  updatePending: boolean;
  /** Whether this request's update to `next` is the one in flight. */
  running: (next: ServiceRequestUpdate['status']) => boolean;
  onUpdate: (body: ServiceRequestUpdate) => void;
  /** Any maintenance hand-off is in flight. */
  toMaintenancePending: boolean;
  /** This request's maintenance hand-off is in flight. */
  toMaintenanceRunning: boolean;
  onToMaintenance: () => void;
}) {
  return (
    <Card
      className={cn(
        'relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1',
        PRIORITY_STRIPE[r.priority],
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4 pl-5 text-sm">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold">
            {r.roomNumber ? t('roomNo', { number: r.roomNumber }) : t('sr.noRoom')} ·{' '}
            {enumLabel('category', r.category)}
          </span>
          <Badge variant={statusVariant(r.status)} dot>
            {statusLabel(r.status)}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{r.requestNo}</span>·
          <span>{enumLabel('department', r.department)}</span>·
          <Badge variant={statusVariant(r.priority)}>{enumLabel('priority', r.priority)}</Badge>
          <span className="ml-auto tabular-nums">{formatTime(r.createdAt, { timeZone })}</span>
        </div>
        {r.guestName && <span className="font-medium">{r.guestName}</span>}
        {r.description && (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-foreground/90">{r.description}</p>
        )}
        {r.rating && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Star className="size-3.5 fill-warning text-warning" />
            {t('sr.rating')}: {r.rating}/5 {r.feedback && `“${r.feedback}”`}
          </span>
        )}
        {canUpdate && r.status !== 'DONE' && r.status !== 'CANCELLED' && (
          <>
            <NativeSelect
              aria-label={t('sr.assignee')}
              className="h-9"
              value={r.assignee?.membershipId ?? ''}
              disabled={updatePending}
              onChange={(e) => onUpdate({ assignedMembershipId: e.target.value || null })}
            >
              <option value="">{t('sr.unassigned')}</option>
              {assignees?.map((a) => (
                <option key={a.membershipId} value={a.membershipId}>
                  {a.displayName}
                </option>
              ))}
            </NativeSelect>
            <div className="flex flex-wrap gap-2">
              {r.status === 'OPEN' && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={running('ACKNOWLEDGED')}
                  disabled={updatePending}
                  onClick={() => onUpdate({ status: 'ACKNOWLEDGED' })}
                >
                  {t('sr.acknowledge')}
                </Button>
              )}
              {r.status !== 'IN_PROGRESS' && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={running('IN_PROGRESS')}
                  disabled={updatePending}
                  onClick={() => onUpdate({ status: 'IN_PROGRESS' })}
                >
                  {t('sr.start')}
                </Button>
              )}
              <Button
                size="sm"
                loading={running('DONE')}
                disabled={updatePending}
                onClick={() => onUpdate({ status: 'DONE' })}
              >
                {!running('DONE') && <Check />}
                {t('sr.complete')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="hover:text-destructive"
                loading={running('CANCELLED')}
                disabled={updatePending}
                onClick={() => onUpdate({ status: 'CANCELLED' })}
              >
                {t('sr.cancel')}
              </Button>
              {r.category === 'MAINTENANCE' && canReportMaintenance && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={toMaintenanceRunning}
                  disabled={toMaintenancePending}
                  onClick={onToMaintenance}
                >
                  {t('sr.toMaintenance')}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
