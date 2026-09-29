import type { Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AccessController } from './modules/access/access.controller.js';
import { AuditController } from './modules/audit/audit.controller.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { CalendarController } from './modules/calendar/calendar.controller.js';
import { GuestEventsController } from './modules/calendar/guest-events.controller.js';
import { DevicesController } from './modules/devices/devices.controller.js';
import { KioskController } from './modules/devices/kiosk.controller.js';
import { PinController } from './modules/devices/pin.controller.js';
import { FinanceController } from './modules/finance/finance.controller.js';
import { GuestPaymentsController } from './modules/finance/payments/guest-payments.controller.js';
import { PaymentWebhooksController } from './modules/finance/payments/payment-webhooks.controller.js';
import { SandboxGatewayController } from './modules/finance/payments/sandbox-gateway.controller.js';
import { FnbController } from './modules/fnb/fnb.controller.js';
import { GuestFnbController } from './modules/fnb/guest-fnb.controller.js';
import { FrontOfficeController } from './modules/front-office/front-office.controller.js';
import { GuestAdminController } from './modules/guest-portal/guest-admin.controller.js';
import { GuestExtrasController } from './modules/guest-portal/guest-extras.controller.js';
import { GuestPortalController } from './modules/guest-portal/guest-portal.controller.js';
import { GuestServiceController } from './modules/guest-portal/guest-service.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { ClockPhotosController } from './modules/hr/time/clock-photos.controller.js';
import { MeController } from './modules/hr/time/me.controller.js';
import { PhotoRetentionController } from './modules/hr/time/photo-retention.controller.js';
import { PropertyHrController } from './modules/hr/time/property-hr.controller.js';
import { StaffingController } from './modules/hr/time/staffing.controller.js';
import { DocumentRetentionController } from './modules/hr/workforce/document-retention.controller.js';
import { EmployeeDocumentsController } from './modules/hr/workforce/employee-documents.controller.js';
import { EmployeeRecordsController } from './modules/hr/workforce/employee-records.controller.js';
import { HrController } from './modules/hr/workforce/hr.controller.js';
import { ManagementController } from './modules/management/management.controller.js';
import { PropertyReportsController } from './modules/management/property-reports.controller.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { LostFoundController } from './modules/operations/lost-found/lost-found.controller.js';
import { MaintenanceController } from './modules/operations/maintenance/maintenance.controller.js';
import { OpsController } from './modules/ops/ops.controller.js';
import { GuestsController } from './modules/pms/guests/guests.controller.js';
import { InventoryController } from './modules/pms/inventory.controller.js';
import { ReservationsController } from './modules/pms/reservations/reservations.controller.js';
import { GuestImagesController } from './modules/privacy/guest-images.controller.js';
import { ImagesController } from './modules/privacy/images.controller.js';
import { ImportsController } from './modules/privacy/imports.controller.js';
import { PrivacyController } from './modules/privacy/privacy.controller.js';
import { OrganizationController } from './modules/tenancy/organization.controller.js';
import { PropertiesController } from './modules/tenancy/properties.controller.js';

/**
 * Every controller of the API, in the order the OpenAPI document lists their operations
 * (docs/api/openapi.json). The context modules own and register the controllers; this list
 * only fixes the documentation order, so moving a controller between modules does not
 * reorder the checked-in document. It is also the route inventory of the tenant isolation
 * suite; api-surface.test.ts checks that it names exactly the registered controllers.
 * Append new controllers at the end.
 */
export const CONTROLLERS: readonly Type[] = [
  HealthController,
  AuthController,
  OrganizationController,
  PropertiesController,
  AccessController,
  AuditController,
  InventoryController,
  ReservationsController,
  GuestsController,
  FrontOfficeController,
  GuestServiceController,
  GuestExtrasController,
  GuestAdminController,
  GuestPortalController,
  HrController,
  EmployeeDocumentsController,
  DocumentRetentionController,
  CalendarController,
  GuestEventsController,
  ManagementController,
  PropertyReportsController,
  NotificationsController,
  MaintenanceController,
  LostFoundController,
  ClockPhotosController,
  PhotoRetentionController,
  DevicesController,
  PinController,
  KioskController,
  MeController,
  EmployeeRecordsController,
  StaffingController,
  OpsController,
  PrivacyController,
  ImportsController,
  ImagesController,
  GuestImagesController,
  PropertyHrController,
  FnbController,
  GuestFnbController,
  FinanceController,
  GuestPaymentsController,
  PaymentWebhooksController,
  SandboxGatewayController,
];

/**
 * Reorders the document's operations by CONTROLLERS, then by method declaration order
 * within the controller (the order Nest itself scans them in). Operation ids are
 * `<Controller>_<method>`. Operations of an unlisted controller go last, in scan order.
 */
export function orderOperations(document: OpenAPIObject): OpenAPIObject {
  const rank = new Map(CONTROLLERS.map((controller, index) => [controller.name, index]));
  const methodIndex = (controllerName: string, methodName: string) => {
    const controller = CONTROLLERS[rank.get(controllerName) ?? -1];
    return controller ? Object.getOwnPropertyNames(controller.prototype).indexOf(methodName) : 0;
  };
  const operations = Object.entries(document.paths).flatMap(([path, item], pathIndex) =>
    Object.entries(item).map(([verb, operation]: [string, { operationId?: string }]) => {
      const id = operation.operationId ?? '';
      const split = id.indexOf('_');
      const controllerName = split < 0 ? id : id.slice(0, split);
      return {
        path,
        verb,
        operation,
        key: [
          rank.get(controllerName) ?? CONTROLLERS.length,
          rank.has(controllerName) ? methodIndex(controllerName, id.slice(split + 1)) : pathIndex,
        ],
      };
    }),
  );
  operations.sort((a, b) => a.key[0]! - b.key[0]! || a.key[1]! - b.key[1]!);
  const paths: OpenAPIObject['paths'] = {};
  for (const { path, verb, operation } of operations) {
    paths[path] = { ...paths[path], [verb]: operation };
  }
  return { ...document, paths };
}
