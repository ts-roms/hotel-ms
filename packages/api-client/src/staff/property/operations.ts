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
  StaffRef,
  StaffServiceRequestCreate,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** Housekeeping, guest service requests, maintenance, lost and found. */
export function operationsClient({ call, baseUrl, propertyId }: PropertyTransport) {
  return {
    housekeeping: () =>
      op
        .HousekeepingController_housekeepingBoard<HousekeepingBoard>(call, { propertyId })
        .then(data),
    housekeepingStaff: () =>
      op.HousekeepingController_housekeepingStaff<StaffRef[]>(call, { propertyId }).then(data),
    setHousekeepingStatus: (roomId: string, body: SetHousekeepingStatusRequest) =>
      op
        .HousekeepingController_setHousekeepingStatus<HousekeepingBoard['rooms'][number]>(
          call,
          { propertyId, roomId },
          body,
        )
        .then(data),
    createHousekeepingTask: (body: CreateHousekeepingTaskRequest) =>
      op.HousekeepingController_createTask<HousekeepingTask>(call, { propertyId }, body).then(data),
    assignHousekeepingTask: (taskId: string, assignedMembershipId: string | null) =>
      op
        .HousekeepingController_assignTask<HousekeepingTask>(
          call,
          { propertyId, taskId },
          { assignedMembershipId },
        )
        .then(data),
    serviceRequests: (query: Partial<ServiceRequestListQuery> = {}) =>
      op
        .ServiceRequestsController_list<{ items: ServiceRequest[] }>(call, { propertyId }, query)
        .then(items),
    serviceRequestAssignees: () =>
      op
        .ServiceRequestsController_assignees<{ items: StaffRef[] }>(call, { propertyId })
        .then(items),
    createServiceRequest: (body: StaffServiceRequestCreate) =>
      op.ServiceRequestsController_create<ServiceRequest>(call, { propertyId }, body).then(data),
    updateServiceRequest: (requestId: string, version: number, body: ServiceRequestUpdate) =>
      op
        .ServiceRequestsController_update<ServiceRequest>(call, { propertyId, requestId }, body, {
          ifMatch: `W/"${version}"`,
        })
        .then(data),
    maintenance: (query: Partial<MaintenanceListQuery> = {}) =>
      op
        .MaintenanceController_list<{ items: MaintenanceRequest[] }>(
          call,
          { propertyId },
          {
            status: query.status,
            roomId: query.roomId,
            assignedToMe: query.assignedToMe ? 'true' : undefined,
          },
        )
        .then(items),
    maintenanceRequest: (requestId: string) =>
      op
        .MaintenanceController_detail<MaintenanceDetail>(call, { propertyId, requestId })
        .then(data),
    maintenanceTechnicians: () =>
      op.MaintenanceController_technicians<{ items: StaffRef[] }>(call, { propertyId }).then(items),
    reportMaintenance: (body: CreateMaintenanceInput) =>
      op.MaintenanceController_create<MaintenanceRequest>(call, { propertyId }, body).then(data),
    maintenanceAction: (requestId: string, version: number, body: MaintenanceAction) =>
      op
        .MaintenanceController_act<MaintenanceRequest>(call, { propertyId, requestId }, body, {
          ifMatch: `W/"${version}"`,
        })
        .then(data),
    addMaintenancePhoto: (requestId: string, photo: Blob) =>
      op
        .MaintenanceController_addPhoto<MaintenanceDetail>(call, { propertyId, requestId }, photo)
        .then(data),
    maintenancePhotoUrl: (requestId: string, photoId: string) =>
      `${baseUrl}${op.paths.MaintenanceController_photo({ propertyId, requestId, photoId })}`,
    lostFound: (query: Partial<LostFoundListQuery> = {}) =>
      op
        .LostFoundController_list<{ items: LostFoundItem[] }>(call, { propertyId }, query)
        .then(items),
    logLostItem: (body: CreateLostFoundInput) =>
      op.LostFoundController_create<LostFoundItem>(call, { propertyId }, body).then(data),
    closeLostItem: (itemId: string, version: number, body: CloseLostFoundItem) =>
      op
        .LostFoundController_close<LostFoundItem>(call, { propertyId, itemId }, body, {
          ifMatch: `W/"${version}"`,
        })
        .then(data),
  };
}
