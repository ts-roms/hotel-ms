import { z } from 'zod';
import { localDateSchema } from './common.js';

/**
 * Maintenance (spec §32, ADR-0023): requests about rooms or other places, assigned to
 * technicians, with photos and an append-only history. A request can take its room out of
 * order for a date range; the room comes back when the request closes.
 */

export const MAINTENANCE_CATEGORIES = [
  'ELECTRICAL',
  'PLUMBING',
  'HVAC',
  'FURNITURE',
  'APPLIANCE',
  'IT',
  'STRUCTURAL',
  'OTHER',
] as const;
export const MAINTENANCE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const MAINTENANCE_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'DONE',
  'CANCELLED',
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

/** Image types accepted as maintenance photos (checked against the file's own bytes). */
export const MAINTENANCE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAINTENANCE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export const maintenanceUpdateSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['CREATED', 'ASSIGNED', 'STATUS', 'NOTE', 'PHOTO']),
  fromStatus: z.enum(MAINTENANCE_STATUSES).nullable(),
  toStatus: z.enum(MAINTENANCE_STATUSES).nullable(),
  note: z.string().nullable(),
  byName: z.string().nullable(),
  at: z.iso.datetime(),
});
export type MaintenanceUpdate = z.infer<typeof maintenanceUpdateSchema>;

export const maintenanceRequestSchema = z.object({
  id: z.uuid(),
  requestNo: z.string(),
  roomId: z.uuid().nullable(),
  roomNumber: z.string().nullable(),
  /** Where, when it is not a room (e.g. "Lobby elevator"). */
  location: z.string().nullable(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  priority: z.enum(MAINTENANCE_PRIORITIES),
  status: z.enum(MAINTENANCE_STATUSES),
  title: z.string(),
  description: z.string(),
  reportedByName: z.string().nullable(),
  assignedMembershipId: z.uuid().nullable(),
  assignedName: z.string().nullable(),
  /** Assigned to the member asking. */
  assignedToMe: z.boolean(),
  /** The guest service request it came from, if any. */
  serviceRequestId: z.uuid().nullable(),
  /** The room is out of order (off sale) for these dates while the request is open. */
  outOfOrder: z
    .object({
      blockId: z.uuid(),
      startDate: localDateSchema,
      endDate: localDateSchema,
      released: z.boolean(),
    })
    .nullable(),
  resolution: z.string().nullable(),
  photoCount: z.number().int(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type MaintenanceRequest = z.infer<typeof maintenanceRequestSchema>;

export const maintenanceDetailSchema = maintenanceRequestSchema.extend({
  updates: z.array(maintenanceUpdateSchema),
  photos: z.array(z.object({ id: z.uuid(), createdAt: z.iso.datetime() })),
});
export type MaintenanceDetail = z.infer<typeof maintenanceDetailSchema>;

export const createMaintenanceRequestSchema = z
  .strictObject({
    roomId: z.uuid().nullable().default(null),
    location: z.string().trim().max(120).nullable().default(null),
    category: z.enum(MAINTENANCE_CATEGORIES),
    priority: z.enum(MAINTENANCE_PRIORITIES).default('NORMAL'),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    serviceRequestId: z.uuid().nullable().default(null),
    /** Needs maintenance.manage: takes the room off sale for the dates (end exclusive). */
    outOfOrder: z
      .strictObject({ startDate: localDateSchema, endDate: localDateSchema })
      .refine((v) => v.endDate > v.startDate, {
        message: 'End date must be after start date',
        path: ['endDate'],
      })
      .nullable()
      .default(null),
  })
  .refine((v) => v.roomId !== null || !!v.location, {
    message: 'Give a room or a location',
    path: ['location'],
  })
  .refine((v) => v.outOfOrder === null || v.roomId !== null, {
    message: 'Only a room can be taken out of order',
    path: ['outOfOrder'],
  });
export type CreateMaintenanceRequest = z.infer<typeof createMaintenanceRequestSchema>;
/** What a client sends (defaults may be left out). */
export type CreateMaintenanceInput = z.input<typeof createMaintenanceRequestSchema>;

export const maintenanceListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'ALL', ...MAINTENANCE_STATUSES]).default('ACTIVE'),
  roomId: z.uuid().optional(),
  assignedToMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type MaintenanceListQuery = z.infer<typeof maintenanceListQuerySchema>;

/** One workflow step; `note` is required to hold, complete or cancel. */
export const maintenanceActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('ASSIGN'), membershipId: z.uuid() }),
  z.strictObject({ action: z.literal('START') }),
  z.strictObject({ action: z.literal('HOLD'), note: z.string().trim().min(1).max(1000) }),
  z.strictObject({ action: z.literal('COMPLETE'), note: z.string().trim().min(1).max(2000) }),
  z.strictObject({ action: z.literal('CANCEL'), note: z.string().trim().min(1).max(1000) }),
  z.strictObject({
    action: z.literal('PRIORITY'),
    priority: z.enum(MAINTENANCE_PRIORITIES),
  }),
  z.strictObject({ action: z.literal('NOTE'), note: z.string().trim().min(1).max(2000) }),
]);
export type MaintenanceAction = z.infer<typeof maintenanceActionSchema>;

// ---- Lost & found (spec §31) -------------------------------------------------------------

export const LOST_FOUND_STATUSES = ['HELD', 'RETURNED', 'DISPOSED'] as const;

export const lostFoundItemSchema = z.object({
  id: z.uuid(),
  itemNo: z.string(),
  description: z.string(),
  category: z.enum(['VALUABLES', 'DOCUMENTS', 'ELECTRONICS', 'CLOTHING', 'OTHER']),
  foundAt: z.iso.datetime(),
  foundLocation: z.string(),
  roomNumber: z.string().nullable(),
  storageLocation: z.string(),
  foundByName: z.string().nullable(),
  status: z.enum(LOST_FOUND_STATUSES),
  /** Returned: to whom and how it was verified. Disposed: how. */
  closingNote: z.string().nullable(),
  closedAt: z.iso.datetime().nullable(),
  daysHeld: z.number().int(),
  version: z.number().int(),
});
export type LostFoundItem = z.infer<typeof lostFoundItemSchema>;

export const createLostFoundItemSchema = z.strictObject({
  description: z.string().trim().min(1).max(500),
  category: lostFoundItemSchema.shape.category,
  foundLocation: z.string().trim().min(1).max(120),
  roomId: z.uuid().nullable().default(null),
  storageLocation: z.string().trim().min(1).max(120),
  foundAt: z.iso.datetime().optional(),
});
export type CreateLostFoundItem = z.infer<typeof createLostFoundItemSchema>;
export type CreateLostFoundInput = z.input<typeof createLostFoundItemSchema>;

export const closeLostFoundItemSchema = z.strictObject({
  status: z.enum(['RETURNED', 'DISPOSED']),
  /** Returned: owner's name and how ownership was checked. Disposed: donated, discarded… */
  note: z.string().trim().min(3).max(500),
});
export type CloseLostFoundItem = z.infer<typeof closeLostFoundItemSchema>;

export const lostFoundListQuerySchema = z.object({
  status: z.enum(['HELD', 'CLOSED', 'ALL']).default('HELD'),
  q: z.string().trim().max(80).optional(),
});
export type LostFoundListQuery = z.infer<typeof lostFoundListQuerySchema>;
