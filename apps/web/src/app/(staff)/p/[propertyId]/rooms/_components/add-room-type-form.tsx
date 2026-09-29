'use client';

import { Alert, Button, Input } from '@hotel/ui';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { useAction } from './use-action';

export function AddRoomTypeForm({
  propertyId,
  onDone,
}: {
  propertyId: string;
  onDone: () => unknown;
}) {
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
