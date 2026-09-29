# ADR-0029: Observability, operations dashboard, restore drill and E2E gate

- Status: Accepted, 2026-10-03
- Spec: §59 (monitoring), §60 (backups and recovery), §61 (testing), blueprint §24 (pipeline)
- Builds on ADR-0003 (tenant isolation), ADR-0005 (outbox), ADR-0010 (AWS and deploys)

## Decision

**Tracing: OpenTelemetry, vendor-neutral.**

- The API and worker load `dist/tracing.js` with `node --import` before the app, so HTTP,
  Postgres, Redis, AWS SDK and Nest handler spans are recorded.
- It is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. In AWS, an ADOT collector sidecar
  (`tracing_enabled`) receives OTLP on localhost and forwards to X-Ray.
- Sampling is parent-based at 10% (`tracing_sample_ratio`).
- Log lines carry `trace_id` and `span_id`, joining CloudWatch logs to traces.

**Errors: Sentry, errors only.**

- Unexpected 5xx responses, failed jobs, and outbox relay and scheduler errors are reported
  when `SENTRY_DSN` is set (`sentry_enabled`, DSN in the app secret). Otherwise nothing is
  sent.
- Sentry runs without its own tracing, so it never competes with OpenTelemetry.
- No personal data leaves: user info, cookies, headers, query strings, bodies, database query
  data and queue payloads are all off. An event carries the request id, route, organization
  id or job id, enough to find the rest in the logs.
- Each deploy stamps `RELEASE` (the commit SHA) into the tasks, so errors group by release.

**Operations dashboard, for platform operators.**

- An identity with `platform_role = 'OPERATOR'` can open `/ops`, and only with two-step
  verification; everyone else gets a 404.
- The API's database role cannot set the flag (column privilege). The owner-only command
  `ops/platform-operator.js` grants and revokes it.
- **Data path.** The API gains no cross-tenant database access. The worker, which already runs
  as `app_system`, writes a snapshot to Redis every 30 seconds:
  - queue depths and recent failed jobs;
  - outbox backlog, retrying and stuck events;
  - payment webhook failures;
  - when the scheduler last ran.
- The snapshot expires after 5 minutes, so a silent worker shows as missing data rather than
  stale numbers.
- **Actions.** Retrying a failed job goes straight to BullMQ. Retrying a stuck outbox event is
  a command the worker runs. Actions are written to the request log with the operator's id;
  there is no tenant audit log for platform actions.
- The snapshot holds aggregates and error metadata only: never job payloads, webhook bodies,
  or guest or staff data.

**Restore.**

- Recovery is RDS point-in-time restore to a new instance. The runbook is
  `docs/operations/restore.md`.
- `scripts/ops/restore-drill.sh` backs up and restores into a scratch database, then checks
  migrations, forced row-level security on every tenant table, runtime privileges, and exact
  row counts. CI runs it on every push; staging gets a real PITR drill every quarter.
- A logical dump needs a role that bypasses RLS: forced RLS stops even the owner from reading
  every tenant's rows.

**End-to-end tests and the release gate.**

- Playwright tests in `tests/e2e` run against a running stack:
  - smoke tests (`@smoke`): read-only, safe anywhere;
  - a front-desk flow (`@flow`): book a walk-in, assign a room, check in and out.
- A setup step signs in once and reuses the session, so a run makes one login and stays
  within the login rate limit.
- **CI** runs them against production builds on a fresh, seeded database.
- **Staging.** After each staging deploy, the smoke tests run against the site. They sign in
  when the staging environment has `E2E_EMAIL` and `E2E_PASSWORD` secrets for a dedicated staff
  user.
- **Production.** The production workflow refuses a commit that has no successful staging run
  (deploy and smoke). It still needs the reviewers' approval.

## Consequences

- Tracing costs a sidecar per API and worker task, plus X-Ray at 10% of requests. Raise the
  ratio while investigating, not by default.
- Sentry is optional. Without it, errors are still in CloudWatch logs with request ids.
- The ops dashboard lags up to 30 seconds. Alarms (CloudWatch on queue depth, stuck outbox,
  5xx rate) are the next step and are not built here.
- Browser clients (the web and guest apps) do not report errors to Sentry yet; their server
  logs do.
