import * as Sentry from '@sentry/node';

/**
 * Error tracking (ADR-0029): unexpected server errors go to Sentry when SENTRY_DSN is set;
 * otherwise reporting is a no-op. Errors only: traces are OpenTelemetry's job. No personal
 * data is sent (no request bodies, headers, cookies or IP addresses); an event carries the
 * request id, route, and organization id, enough to find the full story in the logs.
 */

export interface ErrorContext {
  requestId?: string;
  organizationId?: string | null;
  route?: string;
  [key: string]: string | number | null | undefined;
}

type Reporter = (error: unknown, context: ErrorContext) => void;

let reporter: Reporter = () => undefined;

export function initErrorReporting(options: {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  service: string;
}): boolean {
  if (!options.dsn) return false;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    serverName: options.service,
    // No personal data: no user info, cookies, headers, query strings or bodies.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      urlQueryParams: false,
      httpBodies: [],
      databaseQueryData: false,
      queues: false,
    },
    // Errors only; no performance instrumentation competing with OpenTelemetry.
    defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance(),
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
  });
  reporter = (error, context) => {
    Sentry.withScope((scope) => {
      scope.setTag('service', options.service);
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined && value !== null) scope.setTag(key, String(value));
      }
      Sentry.captureException(error);
    });
  };
  return true;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  try {
    reporter(error, context);
  } catch {
    // Reporting must never make an error worse.
  }
}

/** Tests replace the reporter to observe what would be sent. */
export function setErrorReporter(next: Reporter): Reporter {
  const previous = reporter;
  reporter = next;
  return previous;
}

export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
