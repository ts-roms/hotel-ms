import { z } from 'zod';
import { localDateSchema } from './common.js';

/**
 * Management layer (spec §41–42, §66–67, §73–74, ADR-0025): dashboards, reports and
 * global search. Every section is present only when the caller holds the permission that
 * guards the underlying data (null otherwise), so one endpoint serves every role.
 */

// ---- Property dashboard ----------------------------------------------------------------------

export const propertyDashboardSchema = z.object({
  propertyId: z.uuid(),
  propertyName: z.string(),
  businessDate: localDateSchema,
  currency: z.string(),
  rooms: z
    .object({
      total: z.number().int(),
      occupied: z.number().int(),
      outOfOrder: z.number().int(),
      occupancyPct: z.number(),
      arrivalsExpected: z.number().int(),
      arrivalsCheckedIn: z.number().int(),
      departuresExpected: z.number().int(),
      departuresCheckedOut: z.number().int(),
      reservationsMadeToday: z.number().int(),
    })
    .nullable(),
  revenue: z
    .object({ todayMinor: z.number().int(), monthToDateMinor: z.number().int() })
    .nullable(),
  staff: z
    .object({
      scheduled: z.number().int(),
      present: z.number().int(),
      late: z.number().int(),
      absent: z.number().int(),
      onLeave: z.number().int(),
    })
    .nullable(),
  operations: z
    .object({
      dirtyRooms: z.number().int(),
      openMaintenance: z.number().int(),
      urgentMaintenance: z.number().int(),
      openGuestRequests: z.number().int(),
      activeFoodOrders: z.number().int(),
    })
    .nullable(),
  hr: z
    .object({
      pendingLeaveRequests: z.number().int(),
      birthdaysToday: z.array(z.string()),
    })
    .nullable(),
});
export type PropertyDashboard = z.infer<typeof propertyDashboardSchema>;

// ---- Organization dashboard -----------------------------------------------------------------

export const organizationDashboardSchema = z.object({
  organizationName: z.string(),
  properties: z.array(
    z.object({
      propertyId: z.uuid(),
      name: z.string(),
      code: z.string(),
      currency: z.string(),
      businessDate: localDateSchema,
      occupancyPct: z.number().nullable(),
      occupiedRooms: z.number().int().nullable(),
      totalRooms: z.number().int().nullable(),
      revenueTodayMinor: z.number().int().nullable(),
      revenueMonthToDateMinor: z.number().int().nullable(),
      headcount: z.number().int().nullable(),
    }),
  ),
  /** Sums over the properties the caller may see; money only when all share a currency. */
  totals: z.object({
    occupancyPct: z.number().nullable(),
    occupiedRooms: z.number().int(),
    totalRooms: z.number().int(),
    currency: z.string().nullable(),
    revenueTodayMinor: z.number().int().nullable(),
    revenueMonthToDateMinor: z.number().int().nullable(),
    headcount: z.number().int(),
  }),
});
export type OrganizationDashboard = z.infer<typeof organizationDashboardSchema>;

// ---- Reports -------------------------------------------------------------------------------

export const reportRangeQuerySchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema,
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine((v) => v.from <= v.to, { message: 'from must not be after to', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000, {
    message: 'At most one year',
    path: ['to'],
  });
export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

export const occupancyReportSchema = z.object({
  currency: z.string(),
  days: z.array(
    z.object({
      date: localDateSchema,
      roomsAvailable: z.number().int(),
      roomsSold: z.number().int(),
      occupancyPct: z.number(),
      roomRevenueMinor: z.number().int(),
      adrMinor: z.number().int(),
      revparMinor: z.number().int(),
      arrivals: z.number().int(),
      departures: z.number().int(),
      noShows: z.number().int(),
    }),
  ),
  totals: z.object({
    roomsAvailable: z.number().int(),
    roomsSold: z.number().int(),
    occupancyPct: z.number(),
    roomRevenueMinor: z.number().int(),
    adrMinor: z.number().int(),
    revparMinor: z.number().int(),
    cancellations: z.number().int(),
    reservationsMade: z.number().int(),
  }),
  /** Only closed business days count; open days have no final statistics yet. */
  closedDays: z.number().int(),
});
export type OccupancyReport = z.infer<typeof occupancyReportSchema>;

export const hrReportSchema = z.object({
  headcount: z.number().int(),
  byDepartment: z.array(z.object({ department: z.string(), headcount: z.number().int() })),
  attendance: z.object({
    present: z.number().int(),
    late: z.number().int(),
    absent: z.number().int(),
    workedMinutes: z.number().int(),
    lateMinutes: z.number().int(),
    overtimeMinutes: z.number().int(),
    undertimeMinutes: z.number().int(),
  }),
  leave: z.array(z.object({ leaveType: z.string(), days: z.number(), requests: z.number().int() })),
});
export type HrReport = z.infer<typeof hrReportSchema>;

export const fnbReportSchema = z.object({
  currency: z.string(),
  orders: z.number().int(),
  cancelled: z.number().int(),
  salesMinor: z.number().int(),
  roomServiceSalesMinor: z.number().int(),
  roomChargedMinor: z.number().int(),
  averageOrderMinor: z.number().int(),
  topItems: z.array(
    z.object({ name: z.string(), quantity: z.number().int(), salesMinor: z.number().int() }),
  ),
  byOutlet: z.array(
    z.object({ outlet: z.string(), orders: z.number().int(), salesMinor: z.number().int() }),
  ),
});
export type FnbReport = z.infer<typeof fnbReportSchema>;

export const guestServiceReportSchema = z.object({
  requests: z.number().int(),
  open: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
  averageCompletionMinutes: z.number().int().nullable(),
  averageRating: z.number().nullable(),
  ratings: z.number().int(),
  byCategory: z.array(
    z.object({
      category: z.string(),
      requests: z.number().int(),
      averageCompletionMinutes: z.number().int().nullable(),
    }),
  ),
});
export type GuestServiceReport = z.infer<typeof guestServiceReportSchema>;

// ---- Global search ----------------------------------------------------------------------------

export const SEARCH_KINDS = [
  'guest',
  'reservation',
  'room',
  'employee',
  'order',
  'invoice',
  'service_request',
  'maintenance',
] as const;

export const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(SEARCH_KINDS),
      id: z.uuid(),
      title: z.string(),
      subtitle: z.string(),
      propertyName: z.string().nullable(),
      /** Path in the staff app. */
      link: z.string(),
    }),
  ),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
