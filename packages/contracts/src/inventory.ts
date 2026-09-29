import { z } from 'zod';
import { localDateSchema, MAX_STAY_NIGHTS, nightsBetween } from './common.js';
import { codeSchema } from './internal.js';

/**
 * Inventory contracts (blueprint §12): buildings and floors, room types, rooms, room blocks
 * and availability. Stay dates are property-local calendar dates "YYYY-MM-DD"; end dates are
 * exclusive.
 */

export const HOUSEKEEPING_STATUSES = ['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED'] as const;
export const SERVICE_STATUSES = ['IN_SERVICE', 'OUT_OF_SERVICE', 'OUT_OF_ORDER'] as const;

// ---- Physical inventory ------------------------------------------------------------------

export const buildingSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  floors: z.array(z.object({ id: z.uuid(), level: z.number().int(), name: z.string() })),
});
export type Building = z.infer<typeof buildingSchema>;

export const createBuildingRequestSchema = z.strictObject({
  code: codeSchema,
  name: z.string().trim().min(1).max(80),
  floors: z
    .array(
      z.strictObject({
        level: z.number().int().min(-5).max(200),
        name: z.string().trim().min(1).max(40),
      }),
    )
    .max(200)
    .default([]),
});
export type CreateBuildingRequest = z.infer<typeof createBuildingRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateBuildingRequestInput = z.input<typeof createBuildingRequestSchema>;

export const roomTypeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  baseOccupancy: z.number().int(),
  maxOccupancy: z.number().int(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  roomCount: z.number().int(),
  version: z.number().int(),
});
export type RoomType = z.infer<typeof roomTypeSchema>;

const roomTypeFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000),
  baseOccupancy: z.number().int().min(1).max(20),
  maxOccupancy: z.number().int().min(1).max(20),
  sortOrder: z.number().int().min(0).max(1000),
};

export const createRoomTypeRequestSchema = z
  .strictObject({
    code: codeSchema,
    ...roomTypeFields,
    description: roomTypeFields.description.default(''),
    sortOrder: roomTypeFields.sortOrder.default(0),
  })
  .refine((v) => v.maxOccupancy >= v.baseOccupancy, {
    message: 'Max occupancy must be at least base occupancy',
    path: ['maxOccupancy'],
  });
export type CreateRoomTypeRequest = z.infer<typeof createRoomTypeRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateRoomTypeRequestInput = z.input<typeof createRoomTypeRequestSchema>;

export const updateRoomTypeRequestSchema = z.strictObject(roomTypeFields).partial();
export type UpdateRoomTypeRequest = z.infer<typeof updateRoomTypeRequestSchema>;

export const roomSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  roomTypeId: z.uuid(),
  roomTypeCode: z.string(),
  floorId: z.uuid().nullable(),
  housekeepingStatus: z.enum(HOUSEKEEPING_STATUSES),
  serviceStatus: z.enum(SERVICE_STATUSES),
  /** An out-of-order block covers the current business date. */
  blockedToday: z.boolean(),
  notes: z.string(),
  archived: z.boolean(),
  version: z.number().int(),
});
export type Room = z.infer<typeof roomSchema>;

export const createRoomRequestSchema = z.strictObject({
  number: z.string().regex(/^[A-Za-z0-9-]{1,10}$/, 'Letters, digits and - (1-10 chars)'),
  roomTypeId: z.uuid(),
  floorId: z.uuid().nullable().default(null),
  notes: z.string().trim().max(500).default(''),
});
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateRoomRequestInput = z.input<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = z
  .strictObject({
    roomTypeId: z.uuid(),
    floorId: z.uuid().nullable(),
    notes: z.string().trim().max(500),
  })
  .partial();
export type UpdateRoomRequest = z.infer<typeof updateRoomRequestSchema>;

export const setServiceStatusRequestSchema = z.strictObject({
  status: z.enum(['IN_SERVICE', 'OUT_OF_SERVICE']),
  reason: z.string().trim().max(500).default(''),
});
export type SetServiceStatusRequest = z.infer<typeof setServiceStatusRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type SetServiceStatusRequestInput = z.input<typeof setServiceStatusRequestSchema>;

export const roomBlockSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  startDate: localDateSchema,
  endDate: localDateSchema,
  reason: z.string().nullable(),
  released: z.boolean(),
});
export type RoomBlock = z.infer<typeof roomBlockSchema>;

export const createRoomBlockRequestSchema = z
  .strictObject({
    startDate: localDateSchema,
    endDate: localDateSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'End date must be after start date',
    path: ['endDate'],
  })
  .refine((v) => nightsBetween(v.startDate, v.endDate) <= MAX_STAY_NIGHTS, {
    message: `A block can be at most ${MAX_STAY_NIGHTS} days`,
    path: ['endDate'],
  });
export type CreateRoomBlockRequest = z.infer<typeof createRoomBlockRequestSchema>;
