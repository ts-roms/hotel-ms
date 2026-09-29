import type {
  CloseLostFoundItem,
  CreateHousekeepingTaskRequest,
  CreateLostFoundInput,
  CreateMaintenanceInput,
  HousekeepingBoard,
  HousekeepingTask,
  LostFoundItem,
  LostFoundListQuery,
  MaintenanceAction,
  MaintenanceDetail,
  MaintenanceListQuery,
  MaintenanceRequest,
  ServiceRequest,
  ServiceRequestListQuery,
  ServiceRequestUpdate,
  SetHousekeepingStatusRequest,
  StaffServiceRequestCreate,
} from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Housekeeping, guest service requests, maintenance, lost and found. */
export function operationsClient({ call, qs, baseUrl, p, id }: PropertyTransport) {
  return {
    housekeeping: () => call<HousekeepingBoard>('GET', `${p}/housekeeping`).then((r) => r.data),
    housekeepingStaff: () =>
      call<{ membershipId: string; displayName: string }[]>('GET', `${p}/housekeeping/staff`).then(
        (r) => r.data,
      ),
    setHousekeepingStatus: (roomId: string, body: SetHousekeepingStatusRequest) =>
      call<HousekeepingBoard['rooms'][number]>(
        'PUT',
        `${p}/rooms/${id(roomId)}/housekeeping-status`,
        body,
      ).then((r) => r.data),
    createHousekeepingTask: (body: CreateHousekeepingTaskRequest) =>
      call<HousekeepingTask>('POST', `${p}/housekeeping/tasks`, body).then((r) => r.data),
    assignHousekeepingTask: (taskId: string, assignedMembershipId: string | null) =>
      call<HousekeepingTask>('PUT', `${p}/housekeeping/tasks/${id(taskId)}/assignee`, {
        assignedMembershipId,
      }).then((r) => r.data),
    serviceRequests: (query: Partial<ServiceRequestListQuery> = {}) =>
      call<{ items: ServiceRequest[] }>('GET', `${p}/service-requests${qs(query)}`).then(
        (r) => r.data.items,
      ),
    serviceRequestAssignees: () =>
      call<{ items: { membershipId: string; displayName: string }[] }>(
        'GET',
        `${p}/service-requests/assignees`,
      ).then((r) => r.data.items),
    createServiceRequest: (body: StaffServiceRequestCreate) =>
      call<ServiceRequest>('POST', `${p}/service-requests`, body).then((r) => r.data),
    updateServiceRequest: (requestId: string, version: number, body: ServiceRequestUpdate) =>
      call<ServiceRequest>('PATCH', `${p}/service-requests/${id(requestId)}`, body, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
    maintenance: (query: Partial<MaintenanceListQuery> = {}) =>
      call<{ items: MaintenanceRequest[] }>(
        'GET',
        `${p}/maintenance${qs({
          status: query.status,
          roomId: query.roomId,
          assignedToMe: query.assignedToMe ? 'true' : undefined,
        })}`,
      ).then((r) => r.data.items),
    maintenanceRequest: (requestId: string) =>
      call<MaintenanceDetail>('GET', `${p}/maintenance/${id(requestId)}`).then((r) => r.data),
    maintenanceTechnicians: () =>
      call<{ items: { membershipId: string; displayName: string }[] }>(
        'GET',
        `${p}/maintenance/technicians`,
      ).then((r) => r.data.items),
    reportMaintenance: (body: CreateMaintenanceInput) =>
      call<MaintenanceRequest>('POST', `${p}/maintenance`, body).then((r) => r.data),
    maintenanceAction: (requestId: string, version: number, body: MaintenanceAction) =>
      call<MaintenanceRequest>('POST', `${p}/maintenance/${id(requestId)}/actions`, body, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
    addMaintenancePhoto: (requestId: string, photo: Blob) =>
      call<MaintenanceDetail>('POST', `${p}/maintenance/${id(requestId)}/photos`, photo).then(
        (r) => r.data,
      ),
    maintenancePhotoUrl: (requestId: string, photoId: string) =>
      `${baseUrl}${p}/maintenance/${id(requestId)}/photos/${id(photoId)}`,
    lostFound: (query: Partial<LostFoundListQuery> = {}) =>
      call<{ items: LostFoundItem[] }>('GET', `${p}/lost-found${qs(query)}`).then(
        (r) => r.data.items,
      ),
    logLostItem: (body: CreateLostFoundInput) =>
      call<LostFoundItem>('POST', `${p}/lost-found`, body).then((r) => r.data),
    closeLostItem: (itemId: string, version: number, body: CloseLostFoundItem) =>
      call<LostFoundItem>('POST', `${p}/lost-found/${id(itemId)}/close`, body, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
  };
}
