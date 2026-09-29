'use client';

import type { Room } from '@hotel/contracts';
import { addDays } from '@hotel/format';
import { Alert, Button, Input, Label, Notice, NativeSelect } from '@hotel/ui';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { useAction } from './use-action';

export function BlockRoomForm({
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
