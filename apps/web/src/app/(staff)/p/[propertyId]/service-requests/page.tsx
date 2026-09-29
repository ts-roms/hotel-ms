'use client';

import {
  SERVICE_CATEGORIES,
  SERVICE_DEPARTMENTS,
  type ServiceRequest,
  type ServiceRequestUpdate,
} from '@hotel/contracts';
import { formatTime } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  EmptyState,
  Input,
  LoadingRegion,
  PageHeader,
  NativeSelect,
  Skeleton,
  SegmentedControl,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, Plus, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId } from '@/lib/property';
import { statusLabel, statusVariant } from '@/lib/status';

const PRIORITY_STRIPE: Record<ServiceRequest['priority'], string> = {
  LOW: 'before:bg-border',
  NORMAL: 'before:bg-primary',
  HIGH: 'before:bg-warning',
  URGENT: 'before:bg-destructive',
};

/** Guest service queue (spec §26): guest and staff requests routed by department. */
export default function ServiceRequestsPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const can = useCan();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'ACTIVE' | 'DONE'>('ACTIVE');
  const [department, setDepartment] = useState<string>('');
  const canUpdate = can('guest_service.update');

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
  // A guest's "something is broken" becomes a maintenance request, linked back to it.
  const router = useRouter();
  const canReportMaintenance = can('maintenance.report');
  const toMaintenance = useMutation({
    mutationFn: (r: ServiceRequest) => {
      const roomId = rooms.data?.find((room) => room.number === r.roomNumber)?.id ?? null;
      return pms.reportMaintenance({
        roomId,
        location: roomId ? null : t('sr.guestRequest'),
        category: 'OTHER',
        priority: r.priority === 'URGENT' ? 'URGENT' : r.priority === 'HIGH' ? 'HIGH' : 'NORMAL',
        title: (r.description || t('sr.guestRequest')).slice(0, 120),
        description: `${r.requestNo}: ${r.description}`.slice(0, 2000),
        serviceRequestId: r.id,
      });
    },
    onSuccess: () => router.push(`/p/${propertyId}/maintenance`),
  });
  const update = useMutation({
    mutationFn: (input: { request: ServiceRequest; body: ServiceRequestUpdate }) =>
      pms.updateServiceRequest(input.request.id, input.request.version, input.body),
    onSettled: refresh,
  });
  /** Only the button that started the update shows a spinner. */
  const running = (r: ServiceRequest, next: ServiceRequestUpdate['status']) =>
    update.isPending &&
    update.variables?.request.id === r.id &&
    update.variables.body.status === next;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('sr.title')}
        actions={
          <>
            <SegmentedControl
              options={[
                { value: 'ACTIVE', label: t('sr.active') },
                { value: 'DONE', label: t('sr.done') },
              ]}
              value={status}
              onChange={setStatus}
            />
            <NativeSelect
              className="h-9 w-auto"
              aria-label={t('sr.all')}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">{t('sr.all')}</option>
              {SERVICE_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {statusLabel(d)}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />

      {canUpdate && <NewRequest rooms={rooms.data ?? []} onCreated={refresh} />}
      {(list.error || update.error) && <Alert>{errorMessage(list.error ?? update.error)}</Alert>}
      {list.isPending && (
        <LoadingRegion label={t('loading')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Card key={i} className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </Card>
          ))}
        </LoadingRegion>
      )}
      {list.data?.length === 0 && <EmptyState icon={<BellRing />} title={t('sr.empty')} />}

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((r) => (
          <Card
            key={r.id}
            className={cn(
              'relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1',
              PRIORITY_STRIPE[r.priority],
            )}
          >
            <CardContent className="flex flex-col gap-3 p-4 pl-5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">
                  {r.roomNumber ? `${t('sr.room')} ${r.roomNumber}` : t('sr.noRoom')} ·{' '}
                  {statusLabel(r.category).toLowerCase()}
                </span>
                <Badge variant={statusVariant(r.status)} dot>
                  {statusLabel(r.status)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">{r.requestNo}</span>·
                <span>{statusLabel(r.department)}</span>·
                <Badge variant={statusVariant(r.priority)}>{statusLabel(r.priority)}</Badge>
                <span className="ml-auto tabular-nums">{formatTime(r.createdAt)}</span>
              </div>
              {r.guestName && <span className="font-medium">{r.guestName}</span>}
              {r.description && (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-foreground/90">
                  {r.description}
                </p>
              )}
              {r.rating && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Star className="size-3.5 fill-warning text-warning" />
                  {t('sr.rating')}: {r.rating}/5 {r.feedback && `“${r.feedback}”`}
                </span>
              )}
              {canUpdate && r.status !== 'DONE' && r.status !== 'CANCELLED' && (
                <>
                  <NativeSelect
                    aria-label={t('sr.assignee')}
                    className="h-9"
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
                  </NativeSelect>
                  <div className="flex flex-wrap gap-2">
                    {r.status === 'OPEN' && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={running(r, 'ACKNOWLEDGED')}
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
                        loading={running(r, 'IN_PROGRESS')}
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
                      loading={running(r, 'DONE')}
                      disabled={update.isPending}
                      onClick={() => update.mutate({ request: r, body: { status: 'DONE' } })}
                    >
                      {!running(r, 'DONE') && <Check />}
                      {t('sr.complete')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="hover:text-destructive"
                      loading={running(r, 'CANCELLED')}
                      disabled={update.isPending}
                      onClick={() => update.mutate({ request: r, body: { status: 'CANCELLED' } })}
                    >
                      {t('sr.cancel')}
                    </Button>
                    {r.category === 'MAINTENANCE' && canReportMaintenance && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={toMaintenance.isPending && toMaintenance.variables?.id === r.id}
                        disabled={toMaintenance.isPending}
                        onClick={() => toMaintenance.mutate(r)}
                      >
                        {t('sr.toMaintenance')}
                      </Button>
                    )}
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
                {statusLabel(c)}
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
