import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DocumentRetention,
  EMPLOYEE_DOCUMENT_CATEGORIES,
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_TYPES,
  type EmployeeDocument,
  type UploadEmployeeDocumentQuery,
} from '@hotel/contracts';
import { type Prisma, type Tx, uuidv7 } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate, toDbDate } from '../../common/dates.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { matchesType } from '../../common/uploads.js';
import { TenantDb } from '../../infrastructure/database.js';
import {
  OBJECT_STORAGE,
  ObjectNotFound,
  type ObjectStorage,
} from '../../infrastructure/storage.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { HrAccess } from './hr-access.js';

type DocumentType = (typeof EMPLOYEE_DOCUMENT_TYPES)[number];
type Category = (typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number];

const RETENTION_KEY = 'documentRetention';
/** An upload still pending after this long was interrupted. */
const PENDING_GRACE_MS = 60 * 60_000;
/** Stored and not deleted: what users see. */
const VISIBLE = {
  storedAt: { not: null },
  deletedAt: null,
} satisfies Prisma.EmployeeDocumentWhereInput;

/** Termination date + N months (clamped to the month's last day), as YYYY-MM-DD. */
export function purgeOn(terminatedOn: Date | null, months: number | null): string | null {
  if (!terminatedOn || months === null) return null;
  const y = terminatedOn.getUTCFullYear();
  const m = terminatedOn.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(terminatedOn.getUTCDate(), lastDay)))
    .toISOString()
    .slice(0, 10);
}
type DocumentRow = Prisma.EmployeeDocumentGetPayload<object>;

const PERMISSION = 'employee.documents';

const unsupported = (detail: string) =>
  new ProblemException(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported file', detail);

/**
 * Employee documents (ADR-0019): contracts, government IDs, medical certificates. The
 * permission is sensitive (MFA session), scoped like other employee data, and every view
 * is audited. Files sit in object storage under opaque keys; rows are soft-deleted.
 */
@Injectable()
export class EmployeeDocumentsService {
  private readonly logger = new Logger(EmployeeDocumentsService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** The organization's retention rules; categories without a rule are kept. */
  private async rules(tx: Tx): Promise<DocumentRetention['rules']> {
    const row = await tx.organizationSetting.findUnique({
      where: {
        organizationId_key: { organizationId: this.cls.get('organizationId')!, key: RETENTION_KEY },
      },
    });
    const stored = ((row?.value ?? {}) as { rules?: Partial<DocumentRetention['rules']> }).rules;
    return Object.fromEntries(
      EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => [c, stored?.[c] ?? null]),
    ) as DocumentRetention['rules'];
  }

  private async toDtos(
    tx: Tx,
    rows: DocumentRow[],
    employee: { terminatedOn: Date | null },
  ): Promise<EmployeeDocument[]> {
    const rules = employee.terminatedOn ? await this.rules(tx) : null;
    const ids = [...new Set(rows.flatMap((r) => (r.uploadedBy ? [r.uploadedBy] : [])))];
    const names = new Map(
      ids.length === 0
        ? []
        : (
            await tx.identity.findMany({
              where: { id: { in: ids } },
              select: { id: true, displayName: true },
            })
          ).map((i) => [i.id, i.displayName]),
    );
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      category: r.category as EmployeeDocument['category'],
      title: r.title,
      fileName: r.fileName,
      contentType: r.contentType as DocumentType,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      expiresOn: r.expiresOn ? fromDbDate(r.expiresOn) : null,
      uploadedByName: r.uploadedBy ? (names.get(r.uploadedBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      purgeOn: purgeOn(employee.terminatedOn, rules?.[r.category as Category] ?? null),
    }));
  }

  async list(employeeId: string): Promise<EmployeeDocument[]> {
    return this.db.run(async (tx) => {
      const employee = await this.access.requireEmployee(tx, PERMISSION, employeeId);
      const rows = await tx.employeeDocument.findMany({
        where: { employeeId, ...VISIBLE },
        orderBy: { createdAt: 'desc' },
      });
      return this.toDtos(tx, rows, employee);
    });
  }

  async upload(
    employeeId: string,
    contentType: string | undefined,
    body: unknown,
    meta: UploadEmployeeDocumentQuery,
  ): Promise<EmployeeDocument> {
    const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(EMPLOYEE_DOCUMENT_TYPES as readonly string[]).includes(type)) {
      throw unsupported('Upload a PDF, JPEG, PNG or WebP file.');
    }
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw Problems.validation([{ path: 'body', message: 'The file is empty' }]);
    }
    if (body.length > EMPLOYEE_DOCUMENT_MAX_BYTES) {
      throw new ProblemException(413, 'VALIDATION_FAILED', 'File too large', 'At most 8 MiB.');
    }
    if (!matchesType(body, type as DocumentType)) {
      throw unsupported(`The file's content is not a ${type} file.`);
    }
    const organizationId = this.access.organizationId;
    const id = uuidv7();
    const storageKey = `${organizationId}/employee-documents/${id}`;
    const sha256 = createHash('sha256').update(body).digest('hex');

    // 1. The row, marked pending, so a crash at any later point leaves a trace the daily
    //    sweep can clean up (ADR-0021). Scope is checked here, before anything is stored.
    await this.db.run(async (tx) => {
      await this.access.requireEmployee(tx, PERMISSION, employeeId);
      await tx.employeeDocument.create({
        data: {
          id,
          organizationId,
          employeeId,
          category: meta.category,
          title: meta.title,
          fileName: meta.fileName,
          contentType: type,
          sizeBytes: body.length,
          sha256,
          storageKey,
          expiresOn: meta.expiresOn ? toDbDate(meta.expiresOn) : null,
          uploadedBy: this.access.actorId,
        },
      });
    });
    // 2. The file.
    try {
      await this.storage.put(storageKey, body, type, sha256);
    } catch (error) {
      await this.discardPending(id, storageKey);
      throw error;
    }
    // 3. Stored: now it exists for everyone.
    try {
      return await this.db.run(async (tx) => {
        const employee = await this.access.requireEmployee(tx, PERMISSION, employeeId);
        const row = await tx.employeeDocument.update({
          where: { id },
          data: { storedAt: new Date() },
        });
        await this.audit.record(tx, {
          action: 'employee.document_added',
          entityType: 'employee',
          entityId: employeeId,
          after: {
            documentId: id,
            category: meta.category,
            title: meta.title,
            sizeBytes: body.length,
            sha256,
          },
        });
        await this.outbox.enqueue(tx, 'EmployeeDocumentAdded', {
          employeeId,
          documentId: id,
          category: meta.category,
        });
        return (await this.toDtos(tx, [row], employee))[0]!;
      });
    } catch (error) {
      await this.discardPending(id, storageKey);
      throw error;
    }
  }

  /** Best effort; whatever is left, the daily sweep removes. */
  private async discardPending(id: string, storageKey: string): Promise<void> {
    await this.storage.delete(storageKey).catch(() => undefined);
    await this.db
      .run((tx) => tx.employeeDocument.deleteMany({ where: { id, storedAt: null } }))
      .catch(() => undefined);
  }

  /** Opens a document for download; each access is audited. */
  async open(
    employeeId: string,
    documentId: string,
  ): Promise<{ document: EmployeeDocument; stream: Readable }> {
    const row = await this.db.run(async (tx) => {
      const employee = await this.access.requireEmployee(tx, PERMISSION, employeeId);
      const row = await tx.employeeDocument.findFirst({
        where: { id: documentId, employeeId, ...VISIBLE },
      });
      if (!row) throw Problems.notFound('Document');
      await this.audit.record(tx, {
        action: 'employee.document_viewed',
        entityType: 'employee',
        entityId: employeeId,
        after: { documentId },
      });
      return { row, dto: (await this.toDtos(tx, [row], employee))[0]! };
    });
    try {
      return { document: row.dto, stream: await this.storage.get(row.row.storageKey) };
    } catch (error) {
      if (error instanceof ObjectNotFound) {
        this.logger.error(`Document ${documentId} has no stored file`);
        throw Problems.notFound('Document file');
      }
      throw error;
    }
  }

  async remove(employeeId: string, documentId: string): Promise<void> {
    const storageKey = await this.db.run(async (tx) => {
      await this.access.requireEmployee(tx, PERMISSION, employeeId);
      const row = await tx.employeeDocument.findFirst({
        where: { id: documentId, employeeId, ...VISIBLE },
      });
      if (!row) throw Problems.notFound('Document');
      await tx.employeeDocument.update({
        where: { id: documentId },
        data: {
          deletedAt: new Date(),
          deletedBy: this.cls.get('identityId')!,
          deletionReason: 'USER',
        },
      });
      await this.audit.record(tx, {
        action: 'employee.document_deleted',
        entityType: 'employee',
        entityId: employeeId,
        before: { documentId, title: row.title, category: row.category, sha256: row.sha256 },
      });
      return row.storageKey;
    });
    // The row stays for the audit trail; the file itself goes.
    await this.storage.delete(storageKey).catch((error: unknown) => {
      this.logger.error(`Could not delete stored file of document ${documentId}: ${String(error)}`);
    });
  }

  // ---- Retention (ADR-0021) ---------------------------------------------------------------

  async retention(): Promise<DocumentRetention> {
    return this.db.run(async (tx) => ({ rules: await this.rules(tx) }));
  }

  async setRetention(input: DocumentRetention): Promise<DocumentRetention> {
    return this.db.run(async (tx) => {
      const before = await this.rules(tx);
      const organizationId = this.cls.get('organizationId')!;
      const value = { rules: input.rules } as Prisma.InputJsonValue;
      const updatedBy = this.cls.get('identityId') ?? null;
      await tx.organizationSetting.upsert({
        where: { organizationId_key: { organizationId, key: RETENTION_KEY } },
        create: { organizationId, key: RETENTION_KEY, value, updatedBy },
        update: { value, updatedBy },
      });
      await this.audit.record(tx, {
        action: 'organization.document_retention_changed',
        entityType: 'organization',
        entityId: organizationId,
        before: { rules: before },
        after: { rules: input.rules },
      });
      return { rules: input.rules };
    });
  }

  /**
   * Daily housekeeping for one organization (scheduled job, SYSTEM actor):
   * 1. unfinished uploads older than an hour: file (if any) and row removed;
   * 2. documents past their retention date: soft-deleted as RETENTION, files removed.
   */
  async runDaily(localDate: string): Promise<{ swept: number; purged: number }> {
    const cutoff = new Date(Date.now() - PENDING_GRACE_MS);
    const pending = await this.db.run((tx) =>
      tx.employeeDocument.findMany({
        where: { storedAt: null, createdAt: { lt: cutoff } },
        select: { id: true, storageKey: true },
        take: 500,
      }),
    );
    for (const p of pending) {
      await this.storage.delete(p.storageKey);
      await this.db.run((tx) =>
        tx.employeeDocument.deleteMany({ where: { id: p.id, storedAt: null } }),
      );
    }

    const expired = await this.db.run(async (tx) => {
      const rules = await this.rules(tx);
      const rows = await tx.employeeDocument.findMany({
        where: {
          ...VISIBLE,
          category: { in: EMPLOYEE_DOCUMENT_CATEGORIES.filter((c) => rules[c] !== null) },
          employee: { terminatedOn: { not: null } },
        },
        include: { employee: { select: { terminatedOn: true } } },
        take: 500,
      });
      const due = rows.filter((r) => {
        const on = purgeOn(r.employee.terminatedOn, rules[r.category as Category]);
        return on !== null && on <= localDate;
      });
      for (const r of due) {
        await tx.employeeDocument.update({
          where: { id: r.id },
          data: { deletedAt: new Date(), deletionReason: 'RETENTION' },
        });
        await this.audit.record(tx, {
          action: 'employee.document_expired',
          entityType: 'employee',
          entityId: r.employeeId,
          before: { documentId: r.id, title: r.title, category: r.category, sha256: r.sha256 },
        });
      }
      return due;
    });
    for (const r of expired) {
      await this.storage.delete(r.storageKey).catch((error: unknown) => {
        this.logger.error(`Could not delete stored file of document ${r.id}: ${String(error)}`);
      });
    }
    return { swept: pending.length, purged: expired.length };
  }
}
