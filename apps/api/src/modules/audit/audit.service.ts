import { Injectable } from '@nestjs/common';
import type { Prisma, Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { actorOf } from '../../common/actor.js';
import type { RequestContext } from '../../common/request-context.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  propertyId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  /** Only for events recorded before TenantGuard runs (e.g. login). */
  organizationId?: string;
}

/** Keys never written to audit before/after values. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'secret',
  'secretEncrypted',
]);

@Injectable()
export class AuditService {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  /**
   * Must be called with the same transaction as the change being recorded, so the change
   * and its audit row commit or roll back together (ADR-0005).
   */
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const organizationId = entry.organizationId ?? this.cls.get('organizationId');
    if (!organizationId) throw new Error('Audit entry without organization context');
    await tx.auditLog.create({
      data: {
        organizationId,
        propertyId: entry.propertyId ?? null,
        ...actorOf(this.cls),
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: redact(entry.before) ?? undefined,
        after: redact(entry.after) ?? undefined,
        requestId: this.cls.get('requestId') ?? null,
        ip: this.cls.get('ip') ?? null,
        userAgent: this.cls.get('userAgent')?.slice(0, 512) ?? null,
        deviceId: this.cls.get('device')?.id ?? null,
      },
    });
  }
}

function redact(value: Prisma.InputJsonValue | null | undefined): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value))
    return value.map((v) => redact(v as Prisma.InputJsonValue)) as Prisma.InputJsonValue;
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACTED_KEYS.has(k) ? '[REDACTED]' : redact(v as Prisma.InputJsonValue);
    }
    return out as Prisma.InputJsonValue;
  }
  return value;
}

/** Shallow diff of the fields that changed, for audit before/after. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
): { before: Record<string, unknown>; after: Record<string, unknown>; changed: string[] } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const field of fields) {
    const bv = serialize(before[field]);
    const av = serialize(after[field]);
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      b[field as string] = bv;
      a[field as string] = av;
      changed.push(field as string);
    }
  }
  return { before: b, after: a, changed };
}

function serialize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}
