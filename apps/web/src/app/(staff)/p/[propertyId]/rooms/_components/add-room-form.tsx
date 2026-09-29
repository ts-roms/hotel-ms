'use client';

import type { RoomType } from '@hotel/contracts';
import { Alert, Button, Input, NativeSelect } from '@hotel/ui';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { useAction } from '@/lib/use-action';

export function AddRoomForm({
  propertyId,
  roomTypes,
  onDone,
}: {
  propertyId: string;
  roomTypes: RoomType[];
  onDone: () => unknown;
}) {
  const pms = usePms(propertyId);
  const action = useAction({ onSuccess: () => onDone() });
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
