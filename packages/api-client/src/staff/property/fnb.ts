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
import type { PropertyTransport } from '../../http.js';

/** Outlets, menus and orders. */
export function fnbClient({ call, qs, baseUrl, p, id }: PropertyTransport) {
  return {
    outlets: () => call<{ items: Outlet[] }>('GET', `${p}/outlets`).then((r) => r.data.items),
    menu: (outletId: string) =>
      call<Menu>('GET', `${p}/outlets/${id(outletId)}/menu`).then((r) => r.data),
    createCategory: (outletId: string, name: string) =>
      call<Menu>('POST', `${p}/outlets/${id(outletId)}/menu/categories`, { name }).then(
        (r) => r.data,
      ),
    createMenuItem: (outletId: string, body: CreateMenuItemRequest) =>
      call<MenuItem>('POST', `${p}/outlets/${id(outletId)}/menu/items`, body).then((r) => r.data),
    updateMenuItem: (itemId: string, body: UpdateMenuItemRequest) =>
      call<MenuItem>('PATCH', `${p}/menu-items/${id(itemId)}`, body).then((r) => r.data),
    setItemAvailability: (itemId: string, available: boolean) =>
      call<MenuItem>('PUT', `${p}/menu-items/${id(itemId)}/availability`, { available }).then(
        (r) => r.data,
      ),
    orders: (query: Partial<OrderListQuery> = {}) =>
      call<{ items: Order[] }>('GET', `${p}/orders${qs(query)}`).then((r) => r.data.items),
    placeOrder: (body: StaffOrderRequest, idempotencyKey: string) =>
      call<Order>('POST', `${p}/orders`, body, { 'idempotency-key': idempotencyKey }).then(
        (r) => r.data,
      ),
    setOrderStatus: (orderId: string, version: number, status: OrderStatus) =>
      call<Order>(
        'POST',
        `${p}/orders/${id(orderId)}/status`,
        { status },
        {
          'if-match': `W/"${version}"`,
        },
      ).then((r) => r.data),
    cancelOrder: (orderId: string, version: number, reason: string) =>
      call<Order>(
        'POST',
        `${p}/orders/${id(orderId)}/cancel`,
        { reason },
        {
          'if-match': `W/"${version}"`,
        },
      ).then((r) => r.data),
    /** Server-Sent Events URL for the outlet's kitchen board. */
    orderStreamUrl: (outletId: string) => `${baseUrl}${p}/outlets/${id(outletId)}/orders/stream`,
    setMenuItemImage: (itemId: string, file: Blob) =>
      call<{ imageVersion: string }>('PUT', `${p}/menu-items/${id(itemId)}/image`, file).then(
        (r) => r.data,
      ),
    removeMenuItemImage: (itemId: string) =>
      call<void>('DELETE', `${p}/menu-items/${id(itemId)}/image`).then((r) => r.data),
    menuItemImageUrl: (itemId: string, version: string) =>
      `${baseUrl}${p}/menu-items/${id(itemId)}/image?v=${encodeURIComponent(version)}`,
  };
}
