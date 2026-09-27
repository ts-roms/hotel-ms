'use client';

import type { HousekeepingBoard } from '@hotel/contracts';
import { Alert, Badge, Button, Card, CardContent, cn, Notice, Select } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/lib/errors';
import { type MessageKey, t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

type BoardRoom = HousekeepingBoard['rooms'][number];
type Status = BoardRoom['housekeepingStatus'];

const NEXT_ACTIONS: Record<Status, { to: Status; label: MessageKey; permission: string }[]> = {
  DIRTY: [
    { to: 'CLEANING', label: 'hk.startCleaning', permission: 'housekeeping.update' },
    { to: 'CLEAN', label: 'hk.markClean', permission: 'housekeeping.update' },
  ],
  CLEANING: [{ to: 'CLEAN', label: 'hk.markClean', permission: 'housekeeping.update' }],
  CLEAN: [
    { to: 'INSPECTED', label: 'hk.inspect', permission: 'housekeeping.inspect' },
    { to: 'DIRTY', label: 'hk.markDirty', permission: 'housekeeping.update' },
  ],
  INSPECTED: [{ to: 'DIRTY', label: 'hk.markDirty', permission: 'housekeeping.update' }],
};

const STATUS_STYLE: Record<Status, string> = {
  DIRTY: 'border-destructive/60',
  CLEANING: 'border-yellow-500/70',
  CLEAN: 'border-primary/60',
  INSPECTED: 'border-green-600/70',
};

export default function HousekeepingPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const board = useQuery({
    queryKey: ['housekeeping', propertyId],
    queryFn: pms.housekeeping,
    refetchInterval: 30_000,
  });
  const canAssign = hasPermission(session.data, 'housekeeping.assign');
  const staff = useQuery({
    queryKey: ['housekeeping-staff', propertyId],
    queryFn: pms.housekeepingStaff,
    enabled: canAssign,
  });
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['housekeeping', propertyId] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('hk.title')}</h1>
      {board.data && !board.data.fullBoard && <Notice>{t('hk.mine')}</Notice>}
      {(board.error || action.error) && <Alert>{errorMessage(board.error ?? action.error)}</Alert>}
      {board.data?.rooms.length === 0 && <p className="text-muted-foreground">{t('hk.noRooms')}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {board.data?.rooms.map((room) => (
          <Card
            key={room.roomId}
            className={cn('border-l-4', STATUS_STYLE[room.housekeepingStatus])}
          >
            <CardContent className="flex flex-col gap-2 pt-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{room.number}</span>
                <Badge>{room.housekeepingStatus.toLowerCase()}</Badge>
              </div>
              <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                <span>{room.roomTypeCode}</span>·
                <span>{room.occupied ? t('hk.occupied') : t('hk.vacant')}</span>
                {room.arrivalToday && <Badge>{t('hk.arriving')}</Badge>}
                {room.departureToday && <Badge>{t('hk.departing')}</Badge>}
                {room.serviceStatus !== 'IN_SERVICE' && (
                  <Badge className="text-destructive">
                    {room.serviceStatus.replaceAll('_', ' ').toLowerCase()}
                  </Badge>
                )}
              </div>
              {room.openTask && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>
                    {room.openTask.type.replace('_', ' ').toLowerCase()} ·{' '}
                    {room.openTask.status.replace('_', ' ').toLowerCase()}
                  </span>
                  {canAssign ? (
                    <Select
                      className="h-8 w-auto text-xs"
                      aria-label={t('hk.assignTo')}
                      value={room.openTask.assignee?.membershipId ?? ''}
                      onChange={(e) =>
                        action.mutate(() =>
                          pms.assignHousekeepingTask(room.openTask!.id, e.target.value || null),
                        )
                      }
                    >
                      <option value="">{t('hk.unassigned')}</option>
                      {staff.data?.map((s) => (
                        <option key={s.membershipId} value={s.membershipId}>
                          {s.displayName}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-muted-foreground">
                      {room.openTask.assignee?.displayName ?? t('hk.unassigned')}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {NEXT_ACTIONS[room.housekeepingStatus]
                  .filter((a) => hasPermission(session.data, a.permission))
                  .map((a) => (
                    <Button
                      key={a.to}
                      size="sm"
                      variant={a.to === 'DIRTY' ? 'ghost' : 'outline'}
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate(() =>
                          pms.setHousekeepingStatus(room.roomId, { status: a.to, reason: '' }),
                        )
                      }
                    >
                      {t(a.label)}
                    </Button>
                  ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
