import type {
  Availability,
  CreateRatePlanRequest,
  Quote,
  RatePlan,
  SetRateOverridesRequest,
  TaxRule,
  UpdateRatePlanRequest,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, type PropertyTransport } from '../../http.js';

/** Rate plans, overrides, quotes, availability and tax rules. */
export function pricingClient({ call, propertyId }: PropertyTransport) {
  return {
    ratePlans: () =>
      op.PricingController_listRatePlans<RatePlan[]>(call, { propertyId }).then(data),
    createRatePlan: (body: CreateRatePlanRequest) =>
      op.PricingController_createRatePlan<RatePlan>(call, { propertyId }, body).then(data),
    updateRatePlan: (ratePlanId: string, version: number, body: UpdateRatePlanRequest) =>
      op
        .PricingController_updateRatePlan<RatePlan>(call, { propertyId, ratePlanId }, body, {
          ifMatch: `W/"${version}"`,
        })
        .then(data),
    setRateOverrides: (ratePlanId: string, body: SetRateOverridesRequest) =>
      op.PricingController_setOverrides(call, { propertyId, ratePlanId }, body).then(data),
    quote: (params: {
      roomTypeId: string;
      ratePlanId: string;
      arrivalDate: string;
      departureDate: string;
    }) => op.PricingController_quote<Quote>(call, { propertyId }, params).then(data),
    availability: (from: string, to: string) =>
      op
        .PricingController_availability<Availability>(call, { propertyId }, { from, to })
        .then(data),
    taxRules: () => op.TaxRulesController_taxRules<TaxRule[]>(call, { propertyId }).then(data),
  };
}
