# ADR-0007: Two Redis instances

- Status: Accepted, 2026-09-27

## Decision

- **Cache Redis** (`REDIS_CACHE_URL`, `allkeys-lru`): cache, rate limits, locks, pub/sub.
- **Queue Redis** (`REDIS_QUEUE_URL`, `noeviction`, AOF on): BullMQ only.

BullMQ loses jobs if its keys are evicted, while a cache must be able to evict. The two
policies are incompatible in one instance.

Redis is never a source of truth. Queues can be rebuilt from `outbox_events`.
