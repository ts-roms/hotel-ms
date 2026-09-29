import type {
  Availability,
  CreateRatePlanRequest,
  Quote,
  RatePlan,
  SetRateOverridesRequest,
  TaxRule,
  UpdateRatePlanRequest,
} from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Rate plans, overrides, quotes, availability and tax rules. */
export function pricingClient({ call, qs, p, id }: PropertyTransport) {
  return {
    ratePlans: () => call<RatePlan[]>('GET', `${p}/rate-plans`).then((r) => r.data),
    createRatePlan: (body: CreateRatePlanRequest) =>
      call<RatePlan>('POST', `${p}/rate-plans`, body).then((r) => r.data),
    updateRatePlan: (ratePlanId: string, version: number, body: UpdateRatePlanRequest) =>
      call<RatePlan>('PATCH', `${p}/rate-plans/${id(ratePlanId)}`, body, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
    setRateOverrides: (ratePlanId: string, body: SetRateOverridesRequest) =>
      call<void>('PUT', `${p}/rate-plans/${id(ratePlanId)}/overrides`, body).then((r) => r.data),
    quote: (params: {
      roomTypeId: string;
      ratePlanId: string;
      arrivalDate: string;
      departureDate: string;
    }) => call<Quote>('GET', `${p}/quote${qs(params)}`).then((r) => r.data),
    availability: (from: string, to: string) =>
      call<Availability>('GET', `${p}/availability${qs({ from, to })}`).then((r) => r.data),
    taxRules: () => call<TaxRule[]>('GET', `${p}/tax-rules`).then((r) => r.data),
  };
}
