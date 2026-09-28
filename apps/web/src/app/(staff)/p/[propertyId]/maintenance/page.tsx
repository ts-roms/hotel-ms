'use client';

import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  type MaintenanceAction,
  type MaintenanceRequest,
} from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  EmptyState,
  Input,
  Label,
  PageHeader,
  NativeSelect,
  Textarea,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';

const FILTERS = [
  { key: 'ACTIVE', label: 'mnt.active' },
  { key: 'MINE', label: 'mnt.mine' },
  { key: 'DONE', label: 'mnt.done' },
  { key: 'ALL', label: 'mnt.all' },
] as const;

/** Maintenance requests of the property (spec §32, ADR-0023). */
export default function MaintenancePage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const can = (p: string) => hasPermission(session.data, p);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('ACTIVE');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['maintenance', propertyId, filter],
    queryFn: () =>
      pms.maintenance(
        filter === 'MINE' ? { status: 'ACTIVE', assignedToMe: true } : { status: filter },
      ),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('mnt.title')} description={t('mnt.hint')} />
      <div className="flex flex-wrap gap-2">
        {FILTERS.filter((f) => f.key !== 'MINE' || can('maintenance.work')).map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? 'default' : 'outline'}
            onClick={() => setFilter(f.key)}
          >
            {t(f.label)}
          </Button>
        ))}
      </div>
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-2">
          {list.data?.length === 0 && <EmptyState icon={<Wrench />} title={t('mnt.none')} />}
          {list.data?.map((r) => (
            <Button
              key={r.id}
              type="button"
              variant="outline"
              onClick={() => setSelected(r.id)}
              className={cn(
                'h-auto flex-col items-stretch justify-start gap-1 whitespace-normal rounded-xl p-3 text-left font-normal text-foreground hover:bg-accent/40 hover:text-foreground active:scale-100',
                selected === r.id && 'border-primary hover:border-primary',
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{r.requestNo}</span>
                <Badge variant={statusVariant(r.priority)}>{statusLabel(r.priority)}</Badge>
                <Badge variant={statusVariant(r.status)} dot>
                  {statusLabel(r.status)}
                </Badge>
                {r.outOfOrder && !r.outOfOrder.released && (
                  <Badge variant="danger">{t('mnt.outOfOrder')}</Badge>
                )}
              </span>
              <span className="font-medium">{r.title}</span>
              <span className="text-xs text-muted-foreground">
                {r.roomNumber ? `${t('mnt.room')} ${r.roomNumber}` : r.location} ·{' '}
                {statusLabel(r.category)}
                {r.assignedName && ` · ${r.assignedName}`}
              </span>
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {selected && (
            <Detail
              propertyId={propertyId}
              requestId={selected}
              onClose={() => setSelected(null)}
            />
          )}
          {can('maintenance.report') && <Report propertyId={propertyId} onCreated={setSelected} />}
        </div>
      </div>
    </div>
  );
}

function Report({
  propertyId,
  onCreated,
}: {
  propertyId: string;
  onCreated: (id: string) => void;
}) {
  const pms = usePms(propertyId);
  const session = useSession();
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
  const manage = hasPermission(session.data, 'maintenance.manage');
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
                {statusLabel(c)}
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
                {statusLabel(p)}
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

function Detail({
  propertyId,
  requestId,
  onClose,
}: {
  propertyId: string;
  requestId: string;
  onClose: () => void;
}) {
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const can = (p: string) => hasPermission(session.data, p);
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
              {new Date(u.at).toLocaleString('en-PH')} · {u.byName ?? '—'} ·{' '}
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
