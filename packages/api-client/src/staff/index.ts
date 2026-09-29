import { type ApiClientOptions, createCaller, type Transport } from '../http.js';
import { authClient } from './auth.js';
import { organizationClient } from './organization.js';
import { opsClient } from './ops.js';
import { privacyClient } from './privacy.js';
import { hrClient } from './hr.js';
import { meClient } from './me.js';
import { inventoryClient } from './property/inventory.js';
import { pricingClient } from './property/pricing.js';
import { reservationsClient } from './property/reservations.js';
import { frontOfficeClient } from './property/front-office.js';
import { operationsClient } from './property/operations.js';
import { guestServicesClient } from './property/guest-services.js';
import { importsClient } from './property/imports.js';
import { imagesClient } from './property/images.js';
import { financeClient } from './property/finance.js';
import { fnbClient } from './property/fnb.js';
import { insightsClient } from './property/insights.js';
import { calendarClient } from './property/calendar.js';
import { devicesClient } from './property/devices.js';
import { timeClient } from './property/time.js';

/** Endpoints of one property (/properties/{propertyId}/...). */
function propertyClient(transport: Transport, propertyId: string) {
  const property = {
    ...transport,
    p: `/properties/${encodeURIComponent(propertyId)}`,
    id: encodeURIComponent,
  };
  return {
    ...inventoryClient(property),
    ...pricingClient(property),
    ...reservationsClient(property),
    ...frontOfficeClient(property),
    ...operationsClient(property),
    ...guestServicesClient(property),
    ...importsClient(property),
    ...imagesClient(property),
    ...financeClient(property),
    ...fnbClient(property),
    ...insightsClient(property),
    ...calendarClient(property),
    ...devicesClient(property),
    ...timeClient(property),
  };
}

/**
 * The staff app's client. Each group of endpoints lives in its own file (one per bounded
 * context); this assembles them into one object.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const transport: Transport = { ...createCaller(options), baseUrl: options.baseUrl ?? '/api/v1' };
  return {
    ...authClient(transport),
    ...organizationClient(transport),
    pms: (propertyId: string) => propertyClient(transport, propertyId),
    ...opsClient(transport),
    ...privacyClient(transport),
    ...hrClient(transport),
    ...meClient(transport),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
