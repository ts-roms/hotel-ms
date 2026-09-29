'use client';

import { SERVICE_CATEGORIES } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, Input, NativeSelect } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId } from '@/lib/property';
import { enumLabel } from '@/lib/status';

export function NewRequest({
  rooms,
  onCreated,
}: {
  rooms: { id: string; number: string; archived: boolean }[];
  onCreated: () => void;
}) {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const [category, setCategory] = useState<(typeof SERVICE_CATEGORIES)[number]>('TOWELS');
  const [roomId, setRoomId] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () =>
      pms.createServiceRequest({
        category,
        description: description.trim(),
        priority: 'NORMAL',
        roomId: roomId || null,
      }),
    onSuccess: () => {
      setDescription('');
      onCreated();
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Card className="animate-fade-in">
      <CardContent className="pt-5">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
          <NativeSelect
            className="w-auto"
            aria-label={t('sr.room')}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">{t('sr.noRoom')}</option>
            {rooms
              .filter((r) => !r.archived)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number}
                </option>
              ))}
          </NativeSelect>
          <NativeSelect
            className="w-auto"
            aria-label={t('sr.new')}
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {enumLabel('category', c)}
              </option>
            ))}
          </NativeSelect>
          <Input
            className="min-w-48 flex-1"
            placeholder={t('sr.description')}
            aria-label={t('sr.description')}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" loading={create.isPending} disabled={!description.trim()}>
            {!create.isPending && <Plus />}
            {t('sr.create')}
          </Button>
        </form>
        {create.error && <Alert className="mt-2">{errorMessage(create.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
