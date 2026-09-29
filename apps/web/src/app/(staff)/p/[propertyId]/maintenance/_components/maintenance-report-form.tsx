'use client';

import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  type MaintenanceRequest,
} from '@hotel/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms } from '@/lib/property';
import { enumLabel } from '@/lib/status';

export function MaintenanceReportForm({
  propertyId,
  onCreated,
}: {
  propertyId: string;
  onCreated: (id: string) => void;
}) {
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });
  const [roomId, setRoomId] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<string>('OTHER');
  const [priority, setPriority] = useState<string>('NORMAL');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [outOfOrder, setOutOfOrder] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const manage = can('maintenance.manage');
  const report = useMutation({
    mutationFn: () =>
      pms.reportMaintenance({
        roomId: roomId || null,
        location: roomId ? null : location.trim(),
        category: category as MaintenanceRequest['category'],
        priority: priority as MaintenanceRequest['priority'],
        title: title.trim(),
        description: description.trim(),
        outOfOrder: roomId && outOfOrder ? { startDate: from, endDate: to } : null,
      }),
    onSuccess: (created) => {
      setTitle('');
      setDescription('');
      setOutOfOrder(false);
      onCreated(created.id);
      return queryClient.invalidateQueries({ queryKey: ['maintenance', propertyId] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('mnt.report')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-2 text-sm sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            report.mutate();
          }}
        >
          {report.error && <Alert className="sm:col-span-2">{errorMessage(report.error)}</Alert>}
          <NativeSelect
            aria-label={t('mnt.room')}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">{t('mnt.notARoom')}</option>
            {rooms.data
              ?.filter((r) => !r.archived)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {t('mnt.room')} {r.number}
                </option>
              ))}
          </NativeSelect>
          {!roomId && (
            <Input
              required
              aria-label={t('mnt.location')}
              placeholder={t('mnt.location')}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}
          <NativeSelect
            aria-label={t('mnt.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {MAINTENANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {enumLabel('category', c)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t('mnt.priority')}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {MAINTENANCE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {enumLabel('priority', p)}
              </option>
            ))}
          </NativeSelect>
          <Input
            required
            maxLength={120}
            className="sm:col-span-2"
            aria-label={t('mnt.problem')}
            placeholder={t('mnt.problem')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            className="sm:col-span-2"
            aria-label={t('mnt.details')}
            placeholder={t('mnt.details')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {manage && roomId && (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={outOfOrder} onCheckedChange={(v) => setOutOfOrder(v === true)} />
                {t('mnt.takeOutOfOrder')}
              </Label>
              {outOfOrder && (
                <>
                  <Input
                    type="date"
                    className="w-auto"
                    aria-label={t('mnt.from')}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                  <Input
                    type="date"
                    className="w-auto"
                    aria-label={t('mnt.until')}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </>
              )}
            </div>
          )}
          <Button
            type="submit"
            className="self-start"
            loading={report.isPending}
            disabled={!title.trim() || (outOfOrder && (!from || !to))}
          >
            {t('mnt.report')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
