'use client';

import {
  SERVICE_CATEGORIES,
  SERVICE_DEPARTMENTS,
  type ServiceRequest,
  type ServiceRequestUpdate,
} from '@hotel/contracts';
import { Alert, Badge, Button, Card, CardContent, cn, Input, Select } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase();

const PRIORITY_STYLE: Record<ServiceRequest['priority'], string> = {
  LOW: 'border-border',
  NORMAL: 'border-primary/60',
  HIGH: 'border-yellow-500/70',
  URGENT: 'border-destructive/70',
};

/** Guest service queue (spec §26): guest and staff requests routed by department. */
export default function ServiceRequestsPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'ACTIVE' | 'DONE'>('ACTIVE');
  const [department, setDepartment] = useState<string>('');
  const canUpdate = hasPermission(session.data, 'guest_service.update');

  const queryKey = ['service-requests', propertyId, status, department];
  const list = useQuery({
    queryKey,
    queryFn: () =>
      pms.serviceRequests({
        status,
        ...(department ? { department: department as ServiceRequest['department'] } : {}),
      }),
    refetchInterval: 20_000,
  });
  const assignees = useQuery({
    queryKey: ['service-request-assignees', propertyId],
    queryFn: pms.serviceRequestAssignees,
    enabled: canUpdate,
  });
  const rooms = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: pms.rooms,
    enabled: canUpdate,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['service-requests', propertyId] });
  const update = useMutation({
    mutationFn: (input: { request: ServiceRequest; body: ServiceRequestUpdate }) =>
      pms.updateServiceRequest(input.request.id, input.request.version, input.body),
    onSettled: refresh,
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('sr.title')}</h1>
      <div className="flex flex-wrap gap-2">
        {(['ACTIVE', 'DONE'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {t(s === 'ACTIVE' ? 'sr.active' : 'sr.done')}
          </Button>
        ))}
        <Select
          className="w-auto"
          aria-label={t('sr.all')}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">{t('sr.all')}</option>
          {SERVICE_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {label(d)}
            </option>
          ))}
        </Select>
      </div>

      {canUpdate && <NewRequest rooms={rooms.data ?? []} onCreated={refresh} />}
      {(list.error || update.error) && <Alert>{errorMessage(list.error ?? update.error)}</Alert>}
      {list.data?.length === 0 && <p className="text-muted-foreground">{t('sr.empty')}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((r) => (
          <Card key={r.id} className={cn('border-l-4', PRIORITY_STYLE[r.priority])}>
            <CardContent className="flex flex-col gap-2 pt-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {r.roomNumber ? `${t('sr.room')} ${r.roomNumber}` : t('sr.noRoom')} ·{' '}
                  {label(r.category)}
                </span>
                <Badge>{label(r.status)}</Badge>
              </div>
              <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                <span className="font-mono">{r.requestNo}</span>·<span>{label(r.department)}</span>·
                <span>{label(r.priority)}</span>·
                <span>
                  {new Date(r.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {r.guestName && <span>{r.guestName}</span>}
              {r.description && <p>{r.description}</p>}
              {r.rating && (
                <span className="text-muted-foreground">
                  {t('sr.rating')}: {r.rating}/5 {r.feedback && `“${r.feedback}”`}
                </span>
              )}
              {canUpdate && r.status !== 'DONE' && r.status !== 'CANCELLED' && (
                <>
                  <Select
                    aria-label={t('sr.assignee')}
                    value={r.assignee?.membershipId ?? ''}
                    disabled={update.isPending}
                    onChange={(e) =>
                      update.mutate({
                        request: r,
                        body: { assignedMembershipId: e.target.value || null },
                      })
                    }
                  >
                    <option value="">{t('sr.unassigned')}</option>
                    {assignees.data?.map((a) => (
                      <option key={a.membershipId} value={a.membershipId}>
                        {a.displayName}
                      </option>
                    ))}
                  </Select>
                  <div className="flex flex-wrap gap-2">
                    {r.status === 'OPEN' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ request: r, body: { status: 'ACKNOWLEDGED' } })
                        }
                      >
                        {t('sr.acknowledge')}
                      </Button>
                    )}
                    {r.status !== 'IN_PROGRESS' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ request: r, body: { status: 'IN_PROGRESS' } })
                        }
                      >
                        {t('sr.start')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ request: r, body: { status: 'DONE' } })}
                    >
                      {t('sr.complete')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ request: r, body: { status: 'CANCELLED' } })}
                    >
                      {t('sr.cancel')}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NewRequest({
  rooms,
  onCreated,
}: {
  rooms: { id: string; number: string; archived: boolean }[];
  onCreated: () => void;
}) {
  const propertyId = useRoutePropertyId()!;
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
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2" noValidate>
          <Select
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
          </Select>
          <Select
            className="w-auto"
            aria-label={t('sr.new')}
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </Select>
          <Input
            className="min-w-48 flex-1"
            placeholder={t('sr.description')}
            aria-label={t('sr.description')}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" disabled={!description.trim() || create.isPending}>
            {t('sr.create')}
          </Button>
        </form>
        {create.error && <Alert className="mt-2">{errorMessage(create.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
