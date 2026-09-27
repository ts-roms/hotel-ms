import { z } from 'zod';
import { localTimeSchema } from './common.js';

/**
 * F&B contracts (blueprint §14): outlets, menus with modifiers, orders with a price and
 * tax snapshot, the order state machine and room-service delivery.
 */

export const OUTLET_TYPES = ['RESTAURANT', 'BAR', 'CAFE', 'ROOM_SERVICE'] as const;
export const CHARGE_METHODS = ['ROOM_CHARGE', 'PAY_ON_DELIVERY', 'PAY_AT_OUTLET'] as const;
export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Allowed forward moves. CANCELLED is separate: before PREPARING anyone who may update
 * orders can cancel; later only with fnb.order.cancel_override.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED'],
  CONFIRMED: ['PREPARING'],
  PREPARING: ['READY'],
  READY: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

const code = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{1,20}$/, 'Use 1–20 capital letters, digits, "-" or "_"');
const name = z.string().trim().min(1).max(100);
const price = z.number().int().min(0).max(100_000_000);

// ---- Outlets -------------------------------------------------------------------------------

export const outletSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  type: z.enum(OUTLET_TYPES),
  /** Takes room-service orders from the guest portal. */
  roomService: z.boolean(),
  allowRoomCharge: z.boolean(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  active: z.boolean(),
  version: z.number().int(),
});
export type Outlet = z.infer<typeof outletSchema>;

export const createOutletRequestSchema = z.strictObject({
  code,
  name,
  type: z.enum(OUTLET_TYPES),
  roomService: z.boolean().default(false),
  allowRoomCharge: z.boolean().default(true),
  opensAt: localTimeSchema.nullable().default(null),
  closesAt: localTimeSchema.nullable().default(null),
});
export type CreateOutletRequest = z.infer<typeof createOutletRequestSchema>;

export const updateOutletRequestSchema = z
  .strictObject({
    name,
    roomService: z.boolean(),
    allowRoomCharge: z.boolean(),
    opensAt: localTimeSchema.nullable(),
    closesAt: localTimeSchema.nullable(),
    active: z.boolean(),
  })
  .partial();
export type UpdateOutletRequest = z.infer<typeof updateOutletRequestSchema>;

// ---- Menus ---------------------------------------------------------------------------------

export const modifierGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  modifiers: z.array(z.object({ id: z.uuid(), name: z.string(), priceMinor: z.number().int() })),
});
export type ModifierGroup = z.infer<typeof modifierGroupSchema>;

export const menuItemSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  name: z.string(),
  description: z.string(),
  priceMinor: z.number().int(),
  /** Quick "86" toggle: sold out for now. */
  available: z.boolean(),
  archived: z.boolean(),
  modifierGroups: z.array(modifierGroupSchema),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

export const menuCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  items: z.array(menuItemSchema),
});
export type MenuCategory = z.infer<typeof menuCategorySchema>;

export const menuSchema = z.object({
  outlet: outletSchema,
  currency: z.string(),
  /** Whether the outlet is open now (property-local time). */
  open: z.boolean(),
  categories: z.array(menuCategorySchema),
});
export type Menu = z.infer<typeof menuSchema>;

export const createCategoryRequestSchema = z.strictObject({
  name,
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const createMenuItemRequestSchema = z.strictObject({
  categoryId: z.uuid(),
  name,
  description: z.string().trim().max(500).default(''),
  priceMinor: price,
  modifierGroups: z
    .array(
      z
        .strictObject({
          name,
          minSelect: z.number().int().min(0).max(10).default(0),
          maxSelect: z.number().int().min(1).max(10).default(1),
          modifiers: z
            .array(z.strictObject({ name, priceMinor: price.default(0) }))
            .min(1)
            .max(30),
        })
        .refine((g) => g.minSelect <= g.maxSelect && g.minSelect <= g.modifiers.length, {
          message: 'minSelect must not exceed maxSelect or the number of modifiers',
        }),
    )
    .max(10)
    .default([]),
});
export type CreateMenuItemRequest = z.infer<typeof createMenuItemRequestSchema>;

export const updateMenuItemRequestSchema = z
  .strictObject({
    name,
    description: z.string().trim().max(500),
    priceMinor: price,
    available: z.boolean(),
    archived: z.boolean(),
  })
  .partial();
export type UpdateMenuItemRequest = z.infer<typeof updateMenuItemRequestSchema>;

export const setAvailabilityRequestSchema = z.strictObject({ available: z.boolean() });
export type SetAvailabilityRequest = z.infer<typeof setAvailabilityRequestSchema>;

// ---- Orders --------------------------------------------------------------------------------

export const orderItemInputSchema = z.strictObject({
  menuItemId: z.uuid(),
  quantity: z.number().int().min(1).max(50),
  modifierIds: z.array(z.uuid()).max(30).default([]),
  notes: z.string().trim().max(200).default(''),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

const orderBase = {
  outletId: z.uuid(),
  items: z.array(orderItemInputSchema).min(1).max(50),
  notes: z.string().trim().max(500).default(''),
};

export const staffOrderRequestSchema = z
  .strictObject({
    ...orderBase,
    chargeMethod: z.enum(CHARGE_METHODS),
    /** Room of an in-house guest: required for ROOM_CHARGE and room delivery. */
    roomId: z.uuid().nullable().default(null),
  })
  .refine((o) => o.chargeMethod !== 'ROOM_CHARGE' || o.roomId !== null, {
    message: 'A room is required to charge to the room',
    path: ['roomId'],
  });
export type StaffOrderRequest = z.infer<typeof staffOrderRequestSchema>;

export const guestOrderRequestSchema = z.strictObject({
  ...orderBase,
  chargeMethod: z.enum(['ROOM_CHARGE', 'PAY_ON_DELIVERY']),
});
export type GuestOrderRequest = z.infer<typeof guestOrderRequestSchema>;

export const orderSchema = z.object({
  id: z.uuid(),
  orderNo: z.string(),
  outletId: z.uuid(),
  outletName: z.string(),
  source: z.enum(['GUEST', 'STAFF']),
  status: z.enum(ORDER_STATUSES),
  chargeMethod: z.enum(CHARGE_METHODS),
  roomNumber: z.string().nullable(),
  guestName: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      menuItemId: z.uuid(),
      name: z.string(),
      quantity: z.number().int(),
      unitPriceMinor: z.number().int(),
      modifiers: z.array(z.object({ name: z.string(), priceMinor: z.number().int() })),
      lineTotalMinor: z.number().int(),
      notes: z.string(),
    }),
  ),
  currency: z.string(),
  /** Menu prices as charged. */
  subtotalMinor: z.number().int(),
  /** Exclusive taxes added on top (inclusive taxes are inside the subtotal). */
  addedTaxMinor: z.number().int(),
  /** What the guest pays. */
  totalMinor: z.number().int(),
  notes: z.string(),
  /** Posted to the guest folio. */
  charged: z.boolean(),
  cancelReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  events: z.array(z.object({ status: z.enum(ORDER_STATUSES), at: z.iso.datetime() })),
  version: z.number().int(),
});
export type Order = z.infer<typeof orderSchema>;

export const orderTransitionRequestSchema = z.strictObject({
  status: z.enum(['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']),
});
export type OrderTransitionRequest = z.infer<typeof orderTransitionRequestSchema>;

export const cancelOrderRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(200),
});
export type CancelOrderRequest = z.infer<typeof cancelOrderRequestSchema>;

export const orderListQuerySchema = z.object({
  outletId: z.uuid().optional(),
  status: z.enum(['ACTIVE', ...ORDER_STATUSES]).default('ACTIVE'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
