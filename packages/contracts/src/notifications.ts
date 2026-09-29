import { z } from 'zod';

/** In-app notification kinds (spec §40, ADR-0024). */
export const NOTIFICATION_KINDS = [
  'MAINTENANCE_ASSIGNED',
  'MAINTENANCE_URGENT',
  'LEAVE_REQUESTED',
  'LEAVE_DECIDED',
  'SCHEDULE_PUBLISHED',
  'CORRECTION_DECIDED',
  'SERVICE_REQUEST_ASSIGNED',
  'BIRTHDAYS_TODAY',
  'EVENT_INVITED',
  'EVENT_CHANGED',
  'EVENTS_TODAY',
  'GUEST_ID_SUBMITTED',
  'CHECKOUT_REQUESTED',
  'CERTIFICATIONS_EXPIRING',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  /** Path in the staff app to open. */
  link: z.string().nullable(),
  propertyId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const notificationListQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

// ---- Guest inbox and guest messages (ADR-0027) ---------------------------------------------

export const GUEST_NOTIFICATION_KINDS = [
  'SERVICE_REQUEST',
  'ORDER',
  'IDENTITY',
  'CHECKOUT',
  'MESSAGE',
] as const;
export type GuestNotificationKind = (typeof GUEST_NOTIFICATION_KINDS)[number];

export const guestNotificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(GUEST_NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
});
export type GuestNotification = z.infer<typeof guestNotificationSchema>;

/** The front desk writes to a guest's portal feed. */
export const staffGuestMessageSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(1000).default(''),
});
export type StaffGuestMessage = z.infer<typeof staffGuestMessageSchema>;
export type StaffGuestMessageInput = z.input<typeof staffGuestMessageSchema>;
