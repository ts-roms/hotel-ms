import { z } from 'zod';
import { localDateSchema } from './common.js';

/**
 * Events and the unified calendar (spec §38–39, ADR-0026). Events belong to a property;
 * the calendar merges them with reservations, shifts, leave, birthdays and out-of-order
 * rooms, each shown only as far as the viewer's permissions allow.
 */

export const EVENT_CATEGORIES = [
  'HOTEL_EVENT',
  'MEETING',
  'TRAINING',
  'CONFERENCE',
  'MAINTENANCE',
  'EMPLOYEE_ACTIVITY',
  'GROUP_EVENT',
  'GUEST_ACTIVITY',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const hotelEventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  allDay: z.boolean(),
  location: z.string(),
  /** Shown to in-house and arriving guests in the guest portal. */
  guestVisible: z.boolean(),
  status: z.enum(['SCHEDULED', 'CANCELLED']),
  organizerName: z.string().nullable(),
  participants: z.array(z.object({ membershipId: z.uuid(), name: z.string() })),
  version: z.number().int(),
});
export type HotelEvent = z.infer<typeof hotelEventSchema>;

const eventFields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(120).default(''),
  guestVisible: z.boolean().default(false),
  participantMembershipIds: z.array(z.uuid()).max(200).default([]),
};

export const createEventRequestSchema = z
  .strictObject(eventFields)
  .refine((e) => Date.parse(e.endsAt) > Date.parse(e.startsAt), {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateEventRequestInput = z.input<typeof createEventRequestSchema>;
export type CreateEventInput = z.input<typeof createEventRequestSchema>;

export const updateEventRequestSchema = z
  .strictObject({
    title: eventFields.title.optional(),
    description: z.string().trim().max(2000).optional(),
    category: eventFields.category.optional(),
    startsAt: eventFields.startsAt.optional(),
    endsAt: eventFields.endsAt.optional(),
    allDay: z.boolean().optional(),
    location: z.string().trim().max(120).optional(),
    guestVisible: z.boolean().optional(),
    participantMembershipIds: z.array(z.uuid()).max(200).optional(),
    status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
  })
  .refine((e) => Object.keys(e).length > 0, { message: 'Nothing to change' });
export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

export const calendarQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((v) => v.from <= v.to, { message: 'from must not be after to', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, {
    message: 'At most 62 days',
    path: ['to'],
  });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const CALENDAR_KINDS = [
  'ARRIVAL',
  'DEPARTURE',
  'SHIFT',
  'LEAVE',
  'BIRTHDAY',
  'EVENT',
  'OUT_OF_ORDER',
] as const;

export const calendarItemSchema = z.object({
  id: z.string(),
  kind: z.enum(CALENDAR_KINDS),
  title: z.string(),
  /** ISO date (all-day) or date-time. */
  start: z.string(),
  /** Exclusive end, same form as start. */
  end: z.string(),
  allDay: z.boolean(),
  link: z.string().nullable(),
  /** For events: the category; for others null. */
  category: z.enum(EVENT_CATEGORIES).nullable(),
});
export type CalendarItem = z.infer<typeof calendarItemSchema>;

export const calendarSchema = z.object({
  timezone: z.string(),
  items: z.array(calendarItemSchema),
});
export type Calendar = z.infer<typeof calendarSchema>;

/** What a guest sees of hotel events: no staff details. */
export const guestEventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  allDay: z.boolean(),
  location: z.string(),
});
export type GuestEvent = z.infer<typeof guestEventSchema>;
