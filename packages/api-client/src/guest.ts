import type {
  GuestBill,
  GuestCheckoutRequestInput,
  GuestEvent,
  GuestHotelInfo,
  GuestIdType,
  GuestNotification,
  GuestOrderRequest,
  GuestServiceRequestCreate,
  GuestStay,
  Menu,
  Order,
  PaymentIntent,
  PreCheckInRequest,
  SelfCheckInResult,
  ServiceRequest,
} from '@hotel/contracts';
import { type ApiClientOptions, createCaller } from './http.js';

/**
 * Guest portal client (the guest app). Same transport; the guest cookie and the CSRF token
 * from the last stay response authenticate it.
 */
export function createGuestApiClient(options: ApiClientOptions = {}) {
  const { call } = createCaller(options);
  const data = <T>(r: { data: T }) => r.data;
  return {
    exchange: (token: string) => call<GuestStay>('POST', '/guest/session', { token }).then(data),
    logout: () => call<void>('DELETE', '/guest/session').then(data),
    stay: () => call<GuestStay>('GET', '/guest/stay').then(data),
    requestCode: () => call<void>('POST', '/guest/verification').then(data),
    verifyCode: (code: string) =>
      call<GuestStay>('POST', '/guest/verification/confirm', { code }).then(data),
    preCheckIn: (body: PreCheckInRequest) =>
      call<GuestStay>('PUT', '/guest/pre-check-in', body).then(data),
    selfCheckIn: () => call<SelfCheckInResult>('POST', '/guest/check-in').then(data),
    bill: () => call<GuestBill>('GET', '/guest/bill').then(data),
    serviceRequests: () =>
      call<{ items: ServiceRequest[] }>('GET', '/guest/service-requests').then((r) => r.data.items),
    createServiceRequest: (body: GuestServiceRequestCreate) =>
      call<ServiceRequest>('POST', '/guest/service-requests', body).then(data),
    pay: (amountMinor: number | undefined, idempotencyKey: string) =>
      call<PaymentIntent>(
        'POST',
        '/guest/payments',
        amountMinor === undefined ? {} : { amountMinor },
        { 'idempotency-key': idempotencyKey },
      ).then(data),
    payments: () =>
      call<{ items: PaymentIntent[] }>('GET', '/guest/payments').then((r) => r.data.items),
    /** Card hold (pre-authorization) for self check-in; returns the hosted checkout. */
    hold: (idempotencyKey: string) =>
      call<PaymentIntent>('POST', '/guest/holds', {}, { 'idempotency-key': idempotencyKey }).then(
        data,
      ),
    events: () => call<{ items: GuestEvent[] }>('GET', '/guest/events').then((r) => r.data.items),
    /** The file is the body (photo or PDF). */
    uploadId: (file: Blob, documentType: GuestIdType) =>
      call<GuestStay>('POST', `/guest/identity?documentType=${documentType}`, file).then(data),
    hotelInfo: () => call<GuestHotelInfo>('GET', '/guest/hotel-info').then(data),
    notifications: () =>
      call<{ items: GuestNotification[] }>('GET', '/guest/notifications').then((r) => r.data.items),
    markNotificationsRead: () => call<void>('POST', '/guest/notifications/read').then(data),
    requestCheckout: (body: GuestCheckoutRequestInput) =>
      call<ServiceRequest>('POST', '/guest/checkout-request', body).then(data),
    menus: () => call<{ items: Menu[] }>('GET', '/guest/menus').then((r) => r.data.items),
    orders: () => call<{ items: Order[] }>('GET', '/guest/orders').then((r) => r.data.items),
    placeOrder: (body: GuestOrderRequest, idempotencyKey: string) =>
      call<Order>('POST', '/guest/orders', body, { 'idempotency-key': idempotencyKey }).then(data),
    cancelOrder: (orderId: string) =>
      call<Order>('POST', `/guest/orders/${encodeURIComponent(orderId)}/cancel`).then(data),
    rate: (requestId: string, rating: number, feedback = '') =>
      call<ServiceRequest>(
        'PUT',
        `/guest/service-requests/${encodeURIComponent(requestId)}/rating`,
        {
          rating,
          feedback,
        },
      ).then(data),
  };
}

export type GuestApiClient = ReturnType<typeof createGuestApiClient>;
