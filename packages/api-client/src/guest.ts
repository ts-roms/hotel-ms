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
import * as op from './generated/operations.js';
import { type ApiClientOptions, createCaller, data, items } from './http.js';

/**
 * Guest portal client (the guest app). Same transport; the guest cookie and the CSRF token
 * from the last stay response authenticate it.
 */
export function createGuestApiClient(options: ApiClientOptions = {}) {
  const { call, baseUrl } = createCaller(options);
  return {
    exchange: (token: string) =>
      op.GuestPortalController_exchange<GuestStay>(call, { token }).then(data),
    logout: () => op.GuestPortalController_logout(call).then(data),
    stay: () => op.GuestPortalController_stay<GuestStay>(call).then(data),
    requestCode: () => op.GuestPortalController_requestCode(call).then(data),
    verifyCode: (code: string) =>
      op.GuestPortalController_verifyCode<GuestStay>(call, { code }).then(data),
    preCheckIn: (body: PreCheckInRequest) =>
      op.GuestPortalController_preCheckIn<GuestStay>(call, body).then(data),
    selfCheckIn: () => op.GuestPortalController_selfCheckIn<SelfCheckInResult>(call).then(data),
    bill: () => op.GuestPortalController_bill<GuestBill>(call).then(data),
    serviceRequests: () =>
      op.GuestPortalController_listRequests<{ items: ServiceRequest[] }>(call).then(items),
    createServiceRequest: (body: GuestServiceRequestCreate) =>
      op.GuestPortalController_createRequest<ServiceRequest>(call, body).then(data),
    pay: (amountMinor: number | undefined, idempotencyKey: string) =>
      op
        .GuestPaymentsController_pay<PaymentIntent>(
          call,
          amountMinor === undefined ? {} : { amountMinor },
          { idempotencyKey },
        )
        .then(data),
    payments: () => op.GuestPaymentsController_list<{ items: PaymentIntent[] }>(call).then(items),
    /** Card hold (pre-authorization) for self check-in; returns the hosted checkout. */
    hold: (idempotencyKey: string) =>
      op.GuestPaymentsController_hold<PaymentIntent>(call, {}, { idempotencyKey }).then(data),
    events: () => op.GuestEventsController_list<{ items: GuestEvent[] }>(call).then(items),
    /** The file is the body (photo or PDF). */
    uploadId: (file: Blob, documentType: GuestIdType) =>
      op.GuestExtrasController_uploadId<GuestStay>(call, { documentType }, file).then(data),
    hotelInfo: () => op.GuestExtrasController_hotelInfo<GuestHotelInfo>(call).then(data),
    hotelImageUrl: (imageId: string, version: string) =>
      `${baseUrl}${op.paths.GuestImagesController_hotelImage({ imageId })}?v=${encodeURIComponent(version)}`,
    menuItemImageUrl: (itemId: string, version: string) =>
      `${baseUrl}${op.paths.GuestImagesController_menuImage({ itemId })}?v=${encodeURIComponent(version)}`,
    notifications: () =>
      op.GuestExtrasController_notifications<{ items: GuestNotification[] }>(call).then(items),
    markNotificationsRead: () => op.GuestExtrasController_markRead(call).then(data),
    requestCheckout: (body: GuestCheckoutRequestInput) =>
      op.GuestExtrasController_requestCheckout<ServiceRequest>(call, body).then(data),
    menus: () => op.GuestFnbController_menus<{ items: Menu[] }>(call).then(items),
    orders: () => op.GuestFnbController_list<{ items: Order[] }>(call).then(items),
    placeOrder: (body: GuestOrderRequest, idempotencyKey: string) =>
      op.GuestFnbController_place<Order>(call, body, { idempotencyKey }).then(data),
    cancelOrder: (orderId: string) =>
      op.GuestFnbController_cancel<Order>(call, { orderId }).then(data),
    rate: (requestId: string, rating: number, feedback = '') =>
      op
        .GuestPortalController_rate<ServiceRequest>(call, { requestId }, { rating, feedback })
        .then(data),
  };
}

export type GuestApiClient = ReturnType<typeof createGuestApiClient>;
