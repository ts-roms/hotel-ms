'use client';

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingRegion,
  PageHeader,
  Skeleton,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@/lib/i18n';
import { useCan, usePms, useProperty, usePropertyId } from '@/lib/property';
import { statusLabel, statusVariant } from '@/lib/status';
import { AddRoomForm } from './_components/add-room-form';
import { AddRoomTypeForm } from './_components/add-room-type-form';
import { BlockRoomForm } from './_components/block-room-form';
import { RatePlanPrices } from './_components/rate-plan-prices';

export default function RoomsPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const property = useProperty(propertyId);
  const queryClient = useQueryClient();
  const roomTypes = useQuery({ queryKey: ['room-types', propertyId], queryFn: pms.roomTypes });
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });
  const ratePlans = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: pms.ratePlans,
    enabled: can('rate.read'),
  });
  const refresh = () =>
    Promise.all(
      ['room-types', 'rooms', 'rate-plans', 'availability'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k, propertyId] }),
      ),
    );
  const canManageRooms = can('room.manage');
  const canManageRates = can('rate.manage');
  const currency = property.data?.currency ?? 'PHP';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('rooms.title')} />

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="text-base">{t('rooms.roomTypes')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {roomTypes.isPending && (
            <LoadingRegion
              label={t('loading')}
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </LoadingRegion>
          )}
          <ul className="stagger grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {roomTypes.data?.map((rt) => (
              <li
                key={rt.id}
                className="flex flex-col gap-1 rounded-lg border p-3 transition-colors hover:border-ring/40"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="primary" className="font-mono">
                    {rt.code}
                  </Badge>
                  <span className="font-medium">{rt.name}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {rt.roomCount} {t('rooms.rooms').toLowerCase()} · {rt.baseOccupancy}–
                  {rt.maxOccupancy}
                </span>
              </li>
            ))}
          </ul>
          {canManageRooms && <AddRoomTypeForm propertyId={propertyId} onDone={refresh} />}
        </CardContent>
      </Card>

      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="text-base">{t('rooms.rooms')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rooms.isPending && (
            <LoadingRegion label={t('loading')}>
              <SkeletonTable rows={5} columns={4} />
            </LoadingRegion>
          )}
          {rooms.data?.filter((r) => !r.archived).length === 0 && (
            <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
              {t('rooms.none')}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rooms.number')}</TableHead>
                <TableHead>{t('res.roomType')}</TableHead>
                <TableHead>{t('rooms.housekeeping')}</TableHead>
                <TableHead>{t('rooms.service')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="stagger">
              {rooms.data
                ?.filter((r) => !r.archived)
                .map((room) => (
                  <TableRow key={room.id}>
                    <TableCell className="font-semibold">{room.number}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {room.roomTypeCode}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(room.housekeepingStatus)} dot>
                        {statusLabel(room.housekeepingStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(room.serviceStatus)}>
                        {statusLabel(room.serviceStatus)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {canManageRooms && roomTypes.data && (
            <>
              <AddRoomForm propertyId={propertyId} roomTypes={roomTypes.data} onDone={refresh} />
              {rooms.data && property.data && (
                <BlockRoomForm
                  propertyId={propertyId}
                  rooms={rooms.data}
                  businessDate={property.data.currentBusinessDate}
                  onDone={refresh}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {ratePlans.data && roomTypes.data && (
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle className="text-base">{t('rooms.ratePlans')}</CardTitle>
          </CardHeader>
          <CardContent className="stagger flex flex-col gap-6 divide-y [&>*:not(:first-child)]:pt-6">
            {ratePlans.data.map((plan) => (
              <RatePlanPrices
                key={`${plan.id}-${plan.version}`}
                propertyId={propertyId}
                plan={plan}
                roomTypes={roomTypes.data}
                currency={currency}
                editable={canManageRates}
                onDone={refresh}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
