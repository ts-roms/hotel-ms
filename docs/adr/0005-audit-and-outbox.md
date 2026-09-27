# ADR-0005: Transactional audit log and outbox

- Status: Accepted, 2026-09-27
- Blueprint: §17, §20.2

## Decision

- `AuditService.record(tx, …)` and `OutboxService.enqueue(tx, …)` take the caller's
  transaction. A change, its audit row and its domain event commit or roll back together.
- `audit_logs` is append-only. The runtime role has only `INSERT, SELECT`, and a trigger rejects
  `UPDATE/DELETE` even for the owner. Retention will drop whole partitions through a reviewed
  procedure (future ADR). Secret-like keys are redacted from before/after values.
- The worker's relay reads `outbox_events` with `FOR UPDATE SKIP LOCKED` as `app_system`
  and adds BullMQ jobs with `jobId = eventId`. Delivery is at-least-once, duplicates are
  suppressed by the job ID, and handlers must be idempotent.

## Consequences

- No dual-write gap between the database and the queue.
- Monthly partitioning of `audit_logs` and `outbox_events` is **deferred**. The Prisma diff
  engine does not model partitioned tables well, and volume does not need it yet. Convert
  before the tables grow (planned migration with a table rewrite).
