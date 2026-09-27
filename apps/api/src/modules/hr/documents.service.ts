import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
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
type DocumentRow = Prisma.EmployeeDocumentGetPayload<object>;

const PERMISSION = 'employee.documents';

const unsupported = (detail: string) =>
  new ProblemException(415, 'UNSUPPORTED_FILE_TYPE', 'Unsupported file', detail);

/** The file's own bytes must match the type it claims (no HTML or scripts in disguise). */
export function matchesType(body: Buffer, type: DocumentType): boolean {
  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => body[offset + i] === b);
  switch (type) {
    case 'application/pdf':
      return starts([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case 'image/png':
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return starts([0xff, 0xd8, 0xff]);
    case 'image/webp':
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8); // RIFF….WEBP
  }
}

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

  private async toDtos(tx: Tx, rows: DocumentRow[]): Promise<EmployeeDocument[]> {
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
    }));
  }

  async list(employeeId: string): Promise<EmployeeDocument[]> {
    return this.db.run(async (tx) => {
      await this.access.requireEmployee(tx, PERMISSION, employeeId);
      const rows = await tx.employeeDocument.findMany({
        where: { employeeId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return this.toDtos(tx, rows);
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
    // Scope check first, so nothing is stored for an employee the caller cannot see.
    await this.db.run((tx) => this.access.requireEmployee(tx, PERMISSION, employeeId));

    const id = uuidv7();
    const storageKey = `${organizationId}/employee-documents/${id}`;
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.storage.put(storageKey, body, type, sha256);
    try {
      return await this.db.run(async (tx) => {
        await this.access.requireEmployee(tx, PERMISSION, employeeId);
        const row = await tx.employeeDocument.create({
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
        return (await this.toDtos(tx, [row]))[0]!;
      });
    } catch (error) {
      // Do not leave an unreferenced file behind.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Opens a document for download; each access is audited. */
  async open(
    employeeId: string,
    documentId: string,
  ): Promise<{ document: EmployeeDocument; stream: Readable }> {
    const row = await this.db.run(async (tx) => {
      await this.access.requireEmployee(tx, PERMISSION, employeeId);
      const row = await tx.employeeDocument.findFirst({
        where: { id: documentId, employeeId, deletedAt: null },
      });
      if (!row) throw Problems.notFound('Document');
      await this.audit.record(tx, {
        action: 'employee.document_viewed',
        entityType: 'employee',
        entityId: employeeId,
        after: { documentId },
      });
      return { row, dto: (await this.toDtos(tx, [row]))[0]! };
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
        where: { id: documentId, employeeId, deletedAt: null },
      });
      if (!row) throw Problems.notFound('Document');
      await tx.employeeDocument.update({
        where: { id: documentId },
        data: { deletedAt: new Date(), deletedBy: this.cls.get('identityId')! },
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
}
