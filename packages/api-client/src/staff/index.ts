import { type ApiClientOptions, createCaller, type Transport } from '../http.js';
import { accessClient } from './access.js';
import { auditClient } from './audit.js';
import { authClient } from './auth.js';
import { devicesClient } from './devices.js';
import { guestsClient } from './guests.js';
import { managementClient } from './management.js';
import { notificationsClient } from './notifications.js';
import { opsClient } from './ops.js';
import { privacyClient } from './privacy.js';
import { tenancyClient } from './tenancy.js';
import { timeClient } from './time.js';
import { workforceClient } from './workforce.js';
import { calendarClient } from './property/calendar.js';
import { devicesClient as propertyDevicesClient } from './property/devices.js';
import { financeClient } from './property/finance.js';
import { fnbClient } from './property/fnb.js';
import { frontOfficeClient } from './property/front-office.js';
import { guestPortalClient } from './property/guest-portal.js';
import { guestsClient as propertyGuestsClient } from './property/guests.js';
import { imagesClient } from './property/images.js';
import { importsClient } from './property/imports.js';
import { inventoryClient } from './property/inventory.js';
import { managementClient as propertyManagementClient } from './property/management.js';
import { operationsClient } from './property/operations.js';
import { pricingClient } from './property/pricing.js';
import { reservationsClient } from './property/reservations.js';
import { timeClient as propertyTimeClient } from './property/time.js';
import { workforceClient as propertyWorkforceClient } from './property/workforce.js';

/** Endpoints of one property (/properties/{propertyId}/...), one file per API context. */
function propertyClient(transport: Transport, propertyId: string) {
  const property = { ...transport, propertyId };
  return {
    ...inventoryClient(property),
    ...pricingClient(property),
    ...propertyGuestsClient(property),
    ...reservationsClient(property),
    ...frontOfficeClient(property),
    ...operationsClient(property),
    ...guestPortalClient(property),
    ...importsClient(property),
    ...imagesClient(property),
    ...financeClient(property),
    ...fnbClient(property),
    ...propertyManagementClient(property),
    ...calendarClient(property),
    ...propertyDevicesClient(property),
    ...propertyTimeClient(property),
    ...propertyWorkforceClient(property),
  };
}

/**
 * The staff app's client. Each file holds the endpoints of one API context (ADR-0031); this
 * assembles them into one object. `hr` and `me` span contexts, so they are merged here.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const transport = createCaller(options);
  const workforce = workforceClient(transport);
  const time = timeClient(transport);
  return {
    ...authClient(transport),
    ...managementClient(transport),
    ...tenancyClient(transport),
    ...accessClient(transport),
    ...guestsClient(transport),
    ...auditClient(transport),
    pms: (propertyId: string) => propertyClient(transport, propertyId),
    ...opsClient(transport),
    ...privacyClient(transport),
    hr: { ...workforce.hr, ...time.hr },
    me: {
      ...notificationsClient(transport).me,
      ...devicesClient(transport).me,
      ...time.me,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
