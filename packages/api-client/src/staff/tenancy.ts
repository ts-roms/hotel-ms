import type {
  CreatePropertyRequest,
  CursorPageQuery,
  FeatureFlag,
  Property,
  UpdatePropertyRequest,
} from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, items, type Page, type Transport } from '../http.js';

/** Tenancy: the organization's properties and feature flags. */
export function tenancyClient({ call }: Transport) {
  return {
    properties: {
      list: (params: Partial<CursorPageQuery> = {}) =>
        op.PropertiesController_list<Page<Property>>(call, params).then(data),
      get: (propertyId: string) => op.PropertiesController_get<Property>(call, { propertyId }),
      create: (body: CreatePropertyRequest) =>
        op.PropertiesController_create<Property>(call, body).then(data),
      update: (propertyId: string, etag: string, body: UpdatePropertyRequest) =>
        op.PropertiesController_update<Property>(call, { propertyId }, body, { ifMatch: etag }),
    },
    featureFlags: {
      list: () =>
        op.OrganizationController_featureFlags<{ items: FeatureFlag[] }>(call).then(items),
      set: (flagKey: string, enabled: boolean) =>
        op
          .OrganizationController_setFeatureFlag<FeatureFlag>(call, { flagKey }, { enabled })
          .then(data),
    },
  };
}
