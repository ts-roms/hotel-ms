/**
 * Background job payloads that are not domain events (queue: `notifications`).
 * Payloads may contain single-use links; jobs are removed from Redis on completion.
 */
export const NOTIFICATIONS_QUEUE = 'notifications';

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
    };

export type EmailJob = EmailTemplate & {
  to: string;
  locale: string;
  /** Correlates with the API request that triggered the email. */
  correlationId: string | null;
};
