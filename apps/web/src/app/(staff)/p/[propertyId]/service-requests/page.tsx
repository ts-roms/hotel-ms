'use client';

import { type ServiceRequest, type ServiceRequestUpdate } from '@hotel/contracts';
import { Alert, EmptyState, PageHeader } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, usePropertyId, usePropertyTimeZone } from '@/lib/property';
import { NewRequest } from './_components/new-request';
import { ServiceRequestCard } from './_components/service-request-card';
import { ServiceRequestFilters } from './_components/service-request-filters';
import { ServiceRequestsSkeleton } from './_components/service-requests-skeleton';

/** Guest service queue (spec §26): guest and staff requests routed by department. */
export default function ServiceRequestsPage() {
  const timeZone = usePropertyTimeZone();
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
          <ServiceRequestFilters
            status={status}
            onStatusChange={setStatus}
            department={department}
            onDepartmentChange={setDepartment}
          />
        }
      />

      {canUpdate && <NewRequest rooms={rooms.data ?? []} onCreated={refresh} />}
      {(list.error || update.error) && <Alert>{errorMessage(list.error ?? update.error)}</Alert>}
      {list.isPending && <ServiceRequestsSkeleton />}
      {list.data?.length === 0 && <EmptyState icon={<BellRing />} title={t('sr.empty')} />}

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((r) => (
          <ServiceRequestCard
            key={r.id}
            request={r}
            timeZone={timeZone}
            canUpdate={canUpdate}
            canReportMaintenance={canReportMaintenance}
            assignees={assignees.data}
            updatePending={update.isPending}
            running={(next) => running(r, next)}
            onUpdate={(body) => update.mutate({ request: r, body })}
            toMaintenancePending={toMaintenance.isPending}
            toMaintenanceRunning={toMaintenance.isPending && toMaintenance.variables?.id === r.id}
            onToMaintenance={() => toMaintenance.mutate(r)}
          />
        ))}
      </div>
    </div>
  );
}
