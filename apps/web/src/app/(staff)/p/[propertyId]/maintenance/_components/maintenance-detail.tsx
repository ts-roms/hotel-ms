'use client';

import { type MaintenanceAction } from '@hotel/contracts';
import { formatDateTime } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms } from '@/lib/property';
import { statusLabel, statusVariant } from '@/lib/status';

export function MaintenanceDetail({
  propertyId,
  requestId,
  onClose,
}: {
  propertyId: string;
  requestId: string;
  onClose: () => void;
}) {
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['maintenance-request', propertyId, requestId],
    queryFn: () => pms.maintenanceRequest(requestId),
  });
  const technicians = useQuery({
    queryKey: ['maintenance-technicians', propertyId],
    queryFn: pms.maintenanceTechnicians,
    enabled: can('maintenance.manage'),
  });
  const [note, setNote] = useState('');
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['maintenance-request', propertyId, requestId] }),
      queryClient.invalidateQueries({ queryKey: ['maintenance', propertyId] }),
    ]);
  const act = useMutation({
    mutationFn: (action: MaintenanceAction) =>
      pms.maintenanceAction(requestId, detail.data!.version, action),
    onSuccess: () => {
      setNote('');
      return refresh();
    },
  });
  const photo = useMutation({
    mutationFn: (file: File) => pms.addMaintenancePhoto(requestId, file),
    onSuccess: refresh,
  });
  const r = detail.data;
  if (!r) return detail.error ? <Alert>{errorMessage(detail.error)}</Alert> : null;
  const open = r.status !== 'DONE' && r.status !== 'CANCELLED';
  const mine = r.assignedToMe;
  const works = can('maintenance.manage') || (can('maintenance.work') && mine);
  const needsNote = (a: 'HOLD' | 'COMPLETE' | 'CANCEL') => () =>
    note.trim() ? act.mutate({ action: a, note: note.trim() }) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>
            <span className="font-mono text-xs text-muted-foreground">{r.requestNo}</span> {r.title}
          </span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('fin.cancel')}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusVariant(r.status)} dot>
            {statusLabel(r.status)}
          </Badge>
          <Badge variant={statusVariant(r.priority)}>{statusLabel(r.priority)}</Badge>
          <span className="text-muted-foreground">
            {r.roomNumber ? `${t('mnt.room')} ${r.roomNumber}` : r.location} ·{' '}
            {statusLabel(r.category)}
          </span>
        </div>
        {r.description && <p className="whitespace-pre-wrap">{r.description}</p>}
        {r.outOfOrder && (
          <p className={r.outOfOrder.released ? 'text-muted-foreground' : 'text-destructive'}>
            {t('mnt.outOfOrder')}: {r.outOfOrder.startDate} → {r.outOfOrder.endDate}
            {r.outOfOrder.released && ` (${t('mnt.released')})`}
          </p>
        )}
        {r.resolution && (
          <p>
            <strong>{t('mnt.resolution')}:</strong> {r.resolution}
          </p>
        )}
        {act.error && <Alert>{errorMessage(act.error)}</Alert>}

        {open && can('maintenance.manage') && (
          <NativeSelect
            aria-label={t('mnt.assign')}
            value={r.assignedMembershipId ?? ''}
            onChange={(e) =>
              e.target.value && act.mutate({ action: 'ASSIGN', membershipId: e.target.value })
            }
          >
            <option value="">{t('mnt.assign')}</option>
            {technicians.data?.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.displayName}
              </option>
            ))}
          </NativeSelect>
        )}
        {open && (works || can('maintenance.work')) && (
          <div className="flex flex-col gap-2">
            <Input
              aria-label={t('mnt.note')}
              placeholder={t('mnt.noteHint')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {works && (r.status === 'ASSIGNED' || r.status === 'ON_HOLD') && (
                <Button size="sm" onClick={() => act.mutate({ action: 'START' })}>
                  {t('mnt.start')}
                </Button>
              )}
              {works && r.status === 'IN_PROGRESS' && (
                <>
                  <Button size="sm" onClick={needsNote('COMPLETE')} disabled={!note.trim()}>
                    {t('mnt.complete')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={needsNote('HOLD')}
                    disabled={!note.trim()}
                  >
                    {t('mnt.hold')}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={!note.trim()}
                onClick={() => act.mutate({ action: 'NOTE', note: note.trim() })}
              >
                {t('mnt.addNote')}
              </Button>
              {can('maintenance.manage') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-destructive"
                  disabled={!note.trim()}
                  onClick={needsNote('CANCEL')}
                >
                  {t('mnt.cancelRequest')}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {r.photos.map((p) => (
            <a
              key={p.id}
              href={pms.maintenancePhotoUrl(r.id, p.id)}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={pms.maintenancePhotoUrl(r.id, p.id)}
                alt={t('mnt.photo')}
                className="size-20 rounded-lg border object-cover"
              />
            </a>
          ))}
          {can('maintenance.report') && (
            <label className="flex size-20 cursor-pointer items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              {photo.isPending ? '…' : t('mnt.addPhoto')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) photo.mutate(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
        {photo.error && <Alert>{errorMessage(photo.error)}</Alert>}

        <ol className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
          {r.updates.map((u) => (
            <li key={u.id}>
              {formatDateTime(u.at)} · {u.byName ?? '—'} ·{' '}
              {u.toStatus
                ? statusLabel(u.toStatus)
                : t(`mnt.kind.${u.kind}` as Parameters<typeof t>[0])}
              {u.note && `: ${u.note}`}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
