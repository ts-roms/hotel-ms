'use client';

import { HOUSEKEEPING_STATUSES, type HousekeepingBoard } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  ChipGroup,
  cn,
  FilterChip,
  EmptyState,
  LoadingRegion,
  Notice,
  PageHeader,
  NativeSelect,
  Skeleton,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { type MessageKey, t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { enumLabel, statusLabel, statusVariant } from '@/lib/status';

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

const STATUS_STRIPE: Record<Status, string> = {
  DIRTY: 'before:bg-destructive',
  CLEANING: 'before:bg-warning',
  CLEAN: 'before:bg-info',
  INSPECTED: 'before:bg-success',
};

interface Action {
  key: string;
  run: () => Promise<unknown>;
}

export default function HousekeepingPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Status | null>(null);
  const board = useQuery({
    queryKey: ['housekeeping', propertyId],
    queryFn: pms.housekeeping,
    refetchInterval: 30_000,
  });
  const canAssign = can('housekeeping.assign');
  const staff = useQuery({
    queryKey: ['housekeeping-staff', propertyId],
    queryFn: pms.housekeepingStaff,
    enabled: canAssign,
  });
  const action = useMutation({
    mutationFn: (a: Action) => a.run(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['housekeeping', propertyId] }),
  });
  const running = (key: string) => action.isPending && action.variables?.key === key;

  const rooms = board.data?.rooms ?? [];
  const counts = Object.fromEntries(
    HOUSEKEEPING_STATUSES.map((s) => [s, rooms.filter((r) => r.housekeepingStatus === s).length]),
  ) as Record<Status, number>;
  const visible = filter ? rooms.filter((r) => r.housekeepingStatus === filter) : rooms;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('hk.title')} />
      {board.data && !board.data.fullBoard && <Notice>{t('hk.mine')}</Notice>}
      {(board.error || action.error) && <Alert>{errorMessage(board.error ?? action.error)}</Alert>}

      {board.data && rooms.length > 0 && (
        <ChipGroup label={t('hk.summary')} className="animate-fade-in">
          <FilterChip pressed={filter === null} onPressedChange={() => setFilter(null)}>
            {t('hk.all')} <span className="tabular-nums opacity-70">{rooms.length}</span>
          </FilterChip>
          {HOUSEKEEPING_STATUSES.map((s) => (
            <FilterChip key={s} pressed={filter === s} onPressedChange={() => setFilter(s)}>
              <Badge variant={statusVariant(s)} dot className="border-0 bg-transparent p-0">
                {statusLabel(s)}
              </Badge>
              <span className="tabular-nums opacity-70">{counts[s]}</span>
            </FilterChip>
          ))}
        </ChipGroup>
      )}

      {board.isPending && (
        <LoadingRegion label={t('loading')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Card key={i} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-14" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-1/2" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-20 rounded-md" />
              </div>
            </Card>
          ))}
        </LoadingRegion>
      )}
      {board.data?.rooms.length === 0 && (
        <EmptyState icon={<BedDouble />} title={t('hk.noRooms')} />
      )}

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((room) => (
          <Card
            key={room.roomId}
            className={cn(
              'relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1 before:transition-colors',
              STATUS_STRIPE[room.housekeepingStatus],
            )}
          >
            <CardContent className="flex flex-col gap-3 p-4 pl-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xl font-semibold tracking-tight">{room.number}</span>
                <Badge variant={statusVariant(room.housekeepingStatus)} dot>
                  {statusLabel(room.housekeepingStatus)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">{room.roomTypeCode}</span>·
                <span>{room.occupied ? t('hk.occupied') : t('hk.vacant')}</span>
                {room.arrivalToday && <Badge variant="info">{t('hk.arriving')}</Badge>}
                {room.departureToday && <Badge variant="warning">{t('hk.departing')}</Badge>}
                {room.serviceStatus !== 'IN_SERVICE' && (
                  <Badge variant={statusVariant(room.serviceStatus)}>
                    {statusLabel(room.serviceStatus)}
                  </Badge>
                )}
              </div>
              {room.openTask && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs">
                  <span>
                    {enumLabel('hkTask', room.openTask.type)} · {statusLabel(room.openTask.status)}
                  </span>
                  {canAssign ? (
                    <NativeSelect
                      className="ml-auto h-8 w-auto text-xs"
                      aria-label={t('hk.assignTo')}
                      value={room.openTask.assignee?.membershipId ?? ''}
                      disabled={running(`assign:${room.roomId}`)}
                      onChange={(e) =>
                        action.mutate({
                          key: `assign:${room.roomId}`,
                          run: () =>
                            pms.assignHousekeepingTask(room.openTask!.id, e.target.value || null),
                        })
                      }
                    >
                      <option value="">{t('hk.unassigned')}</option>
                      {staff.data?.map((s) => (
                        <option key={s.membershipId} value={s.membershipId}>
                          {s.displayName}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <span className="ml-auto text-muted-foreground">
                      {room.openTask.assignee?.displayName ?? t('hk.unassigned')}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {NEXT_ACTIONS[room.housekeepingStatus]
                  .filter((a) => can(a.permission))
                  .map((a) => {
                    const key = `${room.roomId}:${a.to}`;
                    return (
                      <Button
                        key={a.to}
                        size="sm"
                        variant={a.to === 'DIRTY' ? 'ghost' : 'outline'}
                        loading={running(key)}
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({
                            key,
                            run: () =>
                              pms.setHousekeepingStatus(room.roomId, { status: a.to, reason: '' }),
                          })
                        }
                      >
                        {t(a.label)}
                      </Button>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
