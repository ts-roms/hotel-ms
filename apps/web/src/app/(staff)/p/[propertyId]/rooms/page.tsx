'use client';

import type { RatePlan, Room, RoomType } from '@hotel/contracts';
import { addDays, formatMoney, minorToInput, parseMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  LoadingRegion,
  Notice,
  PageHeader,
  NativeSelect,
  Skeleton,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useProperty, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';

export default function RoomsPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const property = useProperty(propertyId);
  const queryClient = useQueryClient();
  const roomTypes = useQuery({ queryKey: ['room-types', propertyId], queryFn: pms.roomTypes });
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });
  const ratePlans = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: pms.ratePlans,
    enabled: hasPermission(session.data, 'rate.read'),
  });
  const refresh = () =>
    Promise.all(
      ['room-types', 'rooms', 'rate-plans', 'availability'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k, propertyId] }),
      ),
    );
  const canManageRooms = hasPermission(session.data, 'room.manage');
  const canManageRates = hasPermission(session.data, 'rate.manage');
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

function useAction(onDone: () => unknown) {
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => onDone(),
  });
}

function AddRoomTypeForm({ propertyId, onDone }: { propertyId: string; onDone: () => unknown }) {
  const pms = usePms(propertyId);
  const action = useAction(onDone);
  const [form, setForm] = useState({ code: '', name: '', baseOccupancy: 2, maxOccupancy: 2 });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.mutate(() =>
      pms.createRoomType({ ...form, code: form.code.toUpperCase(), description: '', sortOrder: 0 }),
    );
  };
  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-5">
      {action.error && <Alert className="sm:col-span-5">{errorMessage(action.error)}</Alert>}
      <Input
        aria-label={t('rooms.code')}
        placeholder={t('rooms.code')}
        required
        value={form.code}
        onChange={(e) => setForm({ ...form, code: e.target.value })}
      />
      <Input
        aria-label={t('rooms.name')}
        placeholder={t('rooms.name')}
        required
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <Input
        aria-label={t('rooms.baseOcc')}
        type="number"
        min={1}
        value={form.baseOccupancy}
        onChange={(e) => setForm({ ...form, baseOccupancy: Number(e.target.value) })}
      />
      <Input
        aria-label={t('rooms.maxOcc')}
        type="number"
        min={1}
        value={form.maxOccupancy}
        onChange={(e) => setForm({ ...form, maxOccupancy: Number(e.target.value) })}
      />
      <Button type="submit" variant="outline" loading={action.isPending}>
        {t('rooms.addType')}
      </Button>
    </form>
  );
}

function AddRoomForm({
  propertyId,
  roomTypes,
  onDone,
}: {
  propertyId: string;
  roomTypes: RoomType[];
  onDone: () => unknown;
}) {
  const pms = usePms(propertyId);
  const action = useAction(onDone);
  const [number, setNumber] = useState('');
  const [roomTypeId, setRoomTypeId] = useState(roomTypes[0]?.id ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        action.mutate(() =>
          pms.createRoom({
            number,
            roomTypeId: roomTypeId || roomTypes[0]!.id,
            floorId: null,
            notes: '',
          }),
        );
      }}
      className="grid gap-2 sm:grid-cols-3"
    >
      {action.error && <Alert className="sm:col-span-3">{errorMessage(action.error)}</Alert>}
      <Input
        aria-label={t('rooms.number')}
        placeholder={t('rooms.number')}
        required
        value={number}
        onChange={(e) => setNumber(e.target.value)}
      />
      <NativeSelect
        aria-label={t('res.roomType')}
        value={roomTypeId}
        onChange={(e) => setRoomTypeId(e.target.value)}
      >
        {roomTypes.map((rt) => (
          <option key={rt.id} value={rt.id}>
            {rt.code} · {rt.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" loading={action.isPending}>
        {t('rooms.addRoom')}
      </Button>
    </form>
  );
}

function BlockRoomForm({
  propertyId,
  rooms,
  businessDate,
  onDone,
}: {
  propertyId: string;
  rooms: Room[];
  businessDate: string;
  onDone: () => unknown;
}) {
  const pms = usePms(propertyId);
  const action = useAction(onDone);
  const active = rooms.filter((r) => !r.archived);
  const [form, setForm] = useState({
    roomId: active[0]?.id ?? '',
    startDate: businessDate,
    endDate: addDays(businessDate, 1),
    reason: '',
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const { roomId, ...body } = form;
        action.mutate(() => pms.blockRoom(roomId, body));
      }}
      className="grid gap-2 sm:grid-cols-5"
    >
      <Label className="pt-2 sm:col-span-5">{t('rooms.block')}</Label>
      {action.error && <Alert className="sm:col-span-5">{errorMessage(action.error)}</Alert>}
      {action.isSuccess && <Notice className="sm:col-span-5">{t('rooms.saved')}</Notice>}
      <NativeSelect
        aria-label={t('rooms.number')}
        value={form.roomId}
        onChange={(e) => setForm({ ...form, roomId: e.target.value })}
      >
        {active.map((r) => (
          <option key={r.id} value={r.id}>
            {r.number}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label={t('rooms.blockFrom')}
        type="date"
        min={businessDate}
        value={form.startDate}
        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
      />
      <Input
        aria-label={t('rooms.blockTo')}
        type="date"
        min={addDays(form.startDate, 1)}
        value={form.endDate}
        onChange={(e) => setForm({ ...form, endDate: e.target.value })}
      />
      <Input
        aria-label={t('rooms.blockReason')}
        placeholder={t('rooms.blockReason')}
        required
        value={form.reason}
        onChange={(e) => setForm({ ...form, reason: e.target.value })}
      />
      <Button type="submit" variant="outline" loading={action.isPending}>
        {t('rooms.blockSave')}
      </Button>
    </form>
  );
}

function RatePlanPrices({
  propertyId,
  plan,
  roomTypes,
  currency,
  editable,
  onDone,
}: {
  propertyId: string;
  plan: RatePlan;
  roomTypes: RoomType[];
  currency: string;
  editable: boolean;
  onDone: () => unknown;
}) {
  const pms = usePms(propertyId);
  const action = useAction(onDone);
  const initial = Object.fromEntries(
    roomTypes.map((rt) => {
      const price = plan.prices.find((p) => p.roomTypeId === rt.id);
      return [rt.id, price ? minorToInput(price.baseAmountMinor, currency) : ''];
    }),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [invalid, setInvalid] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const prices: { roomTypeId: string; baseAmountMinor: number }[] = [];
    for (const [roomTypeId, text] of Object.entries(values)) {
      if (!text.trim()) continue;
      const amount = parseMoney(text, currency);
      if (amount === null) return setInvalid(true);
      prices.push({ roomTypeId, baseAmountMinor: amount });
    }
    setInvalid(false);
    action.mutate(() => pms.updateRatePlan(plan.id, plan.version, { prices }));
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <div className="font-medium">
        {plan.name} <span className="font-mono text-xs text-muted-foreground">{plan.code}</span>
      </div>
      {(invalid || action.error) && (
        <Alert>{invalid ? t('error.generic') : errorMessage(action.error)}</Alert>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {roomTypes.map((rt) => (
          <label key={rt.id} className="flex flex-col gap-1 text-sm">
            <span>
              {rt.code} · {t('rooms.basePrice')}
            </span>
            {editable ? (
              <Input
                inputMode="decimal"
                value={values[rt.id] ?? ''}
                onChange={(e) => setValues({ ...values, [rt.id]: e.target.value })}
              />
            ) : (
              <span>
                {plan.prices.find((p) => p.roomTypeId === rt.id)
                  ? formatMoney(
                      plan.prices.find((p) => p.roomTypeId === rt.id)!.baseAmountMinor,
                      currency,
                    )
                  : '—'}
              </span>
            )}
          </label>
        ))}
      </div>
      {editable && (
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="self-start"
          loading={action.isPending}
        >
          {t('rooms.savePrices')}
        </Button>
      )}
    </form>
  );
}
