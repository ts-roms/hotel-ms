/**
 * Background job payloads that are not domain events (queue: `notifications`).
 * Payloads may contain single-use links; jobs are removed from Redis on completion.
 */
export const NOTIFICATIONS_QUEUE = 'notifications';

/**
 * Scheduled tenant work (ADR-0017). The worker plans these from the clock (it may only list
 * properties and organizations); the API runs them in the tenant's own context.
 */
export const TENANT_JOBS_QUEUE = 'tenant-jobs';

export type TenantJob =
  | {
      type: 'property.nightly';
      organizationId: string;
      propertyId: string;
      /** Property-local date the run is for. */
      localDate: string;
    }
  | {
      type: 'organization.monthly-accrual';
      organizationId: string;
      /** "YYYY-MM" in the organization's time zone. */
      period: string;
    }
  | {
      /** Guest and staff reminders (ADR-0024), after 09:00 property-local time. */
      type: 'property.daily-reminders';
      organizationId: string;
      propertyId: string;
      localDate: string;
    }
  | {
      /** Document housekeeping (ADR-0021): unfinished uploads, then retention. */
      type: 'organization.daily-documents';
      organizationId: string;
      /** Organization-local date the run is for. */
      localDate: string;
    };

export type EmailTemplate =
  | {
      template: 'password-reset';
      data: { displayName: string; resetUrl: string; expiresInMinutes: number };
    }
  | { template: 'password-changed'; data: { displayName: string } }
  | {
      template: 'member-invitation';
      data: {
        displayName: string;
        organizationName: string;
        inviterName: string;
        acceptUrl: string;
        expiresInDays: number;
      };
    }
  | { template: 'mfa-enabled'; data: { displayName: string } }
  | { template: 'mfa-disabled'; data: { displayName: string } }
  | {
      template: 'guest-portal-link';
      data: { guestName: string; propertyName: string; portalUrl: string; arrivalDate: string };
    }
  | {
      template: 'guest-verification-code';
      data: { propertyName: string; code: string; expiresInMinutes: number };
    }
  | {
      template: 'schedule-published';
      data: {
        employeeName: string;
        propertyName: string;
        from: string;
        to: string;
        shifts: { date: string; startTime: string; endTime: string }[];
        scheduleUrl: string;
      };
    }
  | {
      template: 'booking-confirmation';
      data: {
        guestName: string;
        propertyName: string;
        confirmationNo: string;
        arrivalDate: string;
        departureDate: string;
        rooms: number;
      };
    }
  | {
      template: 'booking-cancelled';
      data: { guestName: string; propertyName: string; confirmationNo: string };
    }
  | {
      template: 'checked-in';
      data: {
        guestName: string;
        propertyName: string;
        roomNumber: string;
        departureDate: string;
        checkOutTime: string;
      };
    }
  | {
      template: 'checkin-reminder';
      data: {
        guestName: string;
        propertyName: string;
        arrivalDate: string;
        checkInTime: string;
        portalUrl: string;
      };
    }
  | {
      template: 'checkout-reminder';
      data: { guestName: string; propertyName: string; checkOutTime: string; roomNumber: string };
    }
  | {
      template: 'payment-received';
      data: {
        guestName: string;
        propertyName: string;
        amount: string;
        folioNo: string;
        reference: string;
      };
    }
  | {
      template: 'leave-decided';
      data: {
        employeeName: string;
        leaveTypeName: string;
        startDate: string;
        endDate: string;
        decision: 'APPROVED' | 'REJECTED';
        note: string;
      };
    };

export type EmailJob = EmailTemplate & {
  to: string;
  locale: string;
  /** Correlates with the API request that triggered the email. */
  correlationId: string | null;
};

/** SMS delivery (worker). Kept short: one segment where possible. */
export const SMS_QUEUE = 'sms';
export interface SmsJob {
  /** E.164, e.g. +639171234567. */
  to: string;
  text: string;
  correlationId: string | null;
}
