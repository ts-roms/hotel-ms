import type {
  CreateMenuItemRequest,
  Menu,
  MenuItem,
  Order,
  OrderListQuery,
  OrderStatus,
  Outlet,
  StaffOrderRequest,
  UpdateMenuItemRequest,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** Outlets, menus and orders. */
export function fnbClient({ call, baseUrl, propertyId }: PropertyTransport) {
  return {
    outlets: () => op.FnbController_outlets<{ items: Outlet[] }>(call, { propertyId }).then(items),
    menu: (outletId: string) =>
      op.FnbController_menu<Menu>(call, { propertyId, outletId }).then(data),
    createCategory: (outletId: string, name: string) =>
      op.FnbController_createCategory<Menu>(call, { propertyId, outletId }, { name }).then(data),
    createMenuItem: (outletId: string, body: CreateMenuItemRequest) =>
      op.FnbController_createItem<MenuItem>(call, { propertyId, outletId }, body).then(data),
    updateMenuItem: (itemId: string, body: UpdateMenuItemRequest) =>
      op.FnbController_updateItem<MenuItem>(call, { propertyId, itemId }, body).then(data),
    setItemAvailability: (itemId: string, available: boolean) =>
      op
        .FnbController_setAvailability<MenuItem>(call, { propertyId, itemId }, { available })
        .then(data),
    orders: (query: Partial<OrderListQuery> = {}) =>
      op.FnbController_list<{ items: Order[] }>(call, { propertyId }, query).then(items),
    placeOrder: (body: StaffOrderRequest, idempotencyKey: string) =>
      op.FnbController_place<Order>(call, { propertyId }, body, { idempotencyKey }).then(data),
    setOrderStatus: (orderId: string, version: number, status: OrderStatus) =>
      op
        .FnbController_transition<Order>(
          call,
          { propertyId, orderId },
          { status },
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
    cancelOrder: (orderId: string, version: number, reason: string) =>
      op
        .FnbController_cancel<Order>(
          call,
          { propertyId, orderId },
          { reason },
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
    /** Server-Sent Events URL for the outlet's kitchen board. */
    orderStreamUrl: (outletId: string) =>
      `${baseUrl}${op.paths.FnbController_stream({ propertyId, outletId })}`,
  };
}
