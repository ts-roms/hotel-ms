/**
 * Employee documents (ADR-0019): sensitive, scoped like employee records, files checked
 * by content, stored under opaque keys, every view audited, deletion removes the file.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createPrismaClient, withDbContext } from '@hotel/database';
import { testDatabaseUrls } from '@hotel/database/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantJobsProcessor } from '../src/modules/jobs/tenant-jobs.processor.js';
import { startTestApp, type TestContext, TestClient } from './harness.js';

let ctx: TestContext;
let admin: TestClient;
let maria: TestClient;
let john: TestClient;
let xyzAdmin: TestClient;

const E = (no: string) => ctx.world.hr.abc.employees[no]!;
const docs = (employee: string) => `/api/v1/employees/${employee}/documents`;
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.alloc(2048, 0x41),
  Buffer.from('\n%%EOF'),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

function upload(
  client: TestClient,
  employee: string,
  body: Buffer,
  contentType: string,
  query: Record<string, string> = {},
) {
  const qs = new URLSearchParams({
    category: 'CONTRACT',
    title: 'Employment contract',
    fileName: 'contract.pdf',
    ...query,
  });
  return client.request('POST', `${docs(employee)}?${qs}`, body, {
    'content-type': contentType,
  });
}

/** Downloads as raw bytes (the JSON client would decode them as text). */
async function download(client: TestClient, employee: string, documentId: string) {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `${docs(employee)}/${documentId}/content`,
    headers: { cookie: client.cookieHeader!, 'x-forwarded-for': '10.0.0.9' },
  });
  return { status: res.statusCode, headers: res.headers, bytes: res.rawPayload };
}

beforeAll(async () => {
  ctx = await startTestApp();
  admin = await TestClient.withMfa(ctx.app, 'admin@abc.test');
  maria = await TestClient.withMfa(ctx.app, 'maria.hr@abc.test');
  john = await TestClient.as(ctx.app, 'john.gm@abc.test');
  xyzAdmin = await TestClient.withMfa(ctx.app, 'admin@xyz.test');
});
afterAll(async () => {
  await ctx?.mailbox.close();
  await ctx?.app.close();
});

describe('employee documents', () => {
  let documentId: string;

  it('HR uploads a file; its bytes, hash and metadata come back exactly', async () => {
    const res = await upload(maria, E('E001'), PDF, 'application/pdf', { expiresOn: '2027-12-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      employeeId: E('E001'),
      category: 'CONTRACT',
      title: 'Employment contract',
      fileName: 'contract.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: createHash('sha256').update(PDF).digest('hex'),
      expiresOn: '2027-12-31',
      uploadedByName: 'Maria Santos',
    });
    documentId = res.body.id;

    const list = await maria.get(docs(E('E001')));
    expect(list.status).toBe(200);
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([documentId]);

    const file = await download(maria, E('E001'), documentId);
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.bytes, PDF)).toBe(0);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe(
      `attachment; filename="contract.pdf"; filename*=UTF-8''contract.pdf`,
    );
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['content-security-policy']).toContain('sandbox');
  });

  it('stores files under opaque keys, and audits every view', async () => {
    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    try {
      const org = { organizationId: ctx.world.abc.organizationId, identityId: null };
      const { row, views } = await withDbContext(app, org, async (tx) => ({
        row: await tx.employeeDocument.findUniqueOrThrow({ where: { id: documentId } }),
        views: await tx.auditLog.count({
          where: { action: 'employee.document_viewed', entityId: E('E001') },
        }),
      }));
      expect(row.storageKey).toBe(
        `${ctx.world.abc.organizationId}/employee-documents/${documentId}`,
      );
      expect(row.storageKey).not.toContain('contract');
      expect(existsSync(join(ctx.env.STORAGE_LOCAL_DIR, ...row.storageKey.split('/')))).toBe(true);
      expect(views).toBe(1);
    } finally {
      await app.$disconnect();
    }
  });

  it('is sensitive and scoped: permission, assignment scope and tenant all apply', async () => {
    // John (GM) sees employee records but not their documents.
    expect((await john.get(docs(E('E001')))).status).toBe(403);
    expect((await upload(john, E('E001'), PDF, 'application/pdf')).status).toBe(403);
    // Maria's HR scope is MNL and CEB; E007 works elsewhere.
    expect((await maria.get(docs(E('E007')))).status).toBe(404);
    expect((await upload(maria, E('E007'), PDF, 'application/pdf')).status).toBe(404);
    expect((await admin.get(docs(E('E007')))).status).toBe(200);
    // Another organization cannot reach the record or the file.
    expect((await xyzAdmin.get(docs(E('E001')))).status).toBe(404);
    expect((await download(xyzAdmin, E('E001'), documentId)).status).toBe(404);
    // A document id only works under its own employee.
    expect((await download(maria, E('E002'), documentId)).status).toBe(404);

    // HR Manager without a second factor: the documents stay out of reach.
    const roles = await admin.get('/api/v1/roles');
    const hrRole = roles.body.find((r: { key: string }) => r.key === 'hr_manager').id;
    const members = await admin.get('/api/v1/members');
    const faye = members.body.find(
      (m: { email: string }) => m.email === 'frontdesk@abc.test',
    ).membershipId;
    const granted = await admin.request('POST', `/api/v1/members/${faye}/role-assignments`, {
      roleId: hrRole,
      propertyId: ctx.world.abc.properties.CEB,
    });
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    const noMfaHr = await TestClient.as(ctx.app, 'frontdesk@abc.test');
    const denied = await noMfaHr.get(docs(E('E005')));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('accepts only real PDF and image files, within the size limit', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await upload(maria, E('E002'), html, 'text/html')).status).toBe(415);
    // Claims to be a PDF, is not.
    const disguised = await upload(maria, E('E002'), html, 'application/pdf');
    expect(disguised.status).toBe(415);
    expect(disguised.body.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect((await upload(maria, E('E002'), PNG, 'application/pdf')).status).toBe(415);
    expect((await upload(maria, E('E002'), Buffer.alloc(0), 'application/pdf')).status).toBe(400);
    const tooBig = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(8 * 1024 * 1024)]);
    expect((await upload(maria, E('E002'), tooBig, 'application/pdf')).status).toBe(413);
    expect(
      (await upload(maria, E('E002'), PDF, 'application/pdf', { fileName: '../etc/passwd' }))
        .status,
    ).toBe(400);
    expect((await upload(maria, E('E002'), PDF, 'application/pdf', { title: '' })).status).toBe(
      400,
    );
    expect(
      (await upload(maria, E('E002'), PDF, 'application/pdf', { category: 'SECRET' })).status,
    ).toBe(400);
    expect((await maria.get(docs(E('E002')))).body.items).toEqual([]);

    const png = await upload(maria, E('E002'), PNG, 'image/png', {
      category: 'GOVERNMENT_ID',
      title: 'Passport',
      fileName: 'pasaporte año 2026.png',
    });
    expect(png.status, JSON.stringify(png.body)).toBe(201);
    const file = await download(maria, E('E002'), png.body.id);
    expect(file.headers['content-disposition']).toBe(
      `attachment; filename="pasaporte a_o 2026.png"; filename*=UTF-8''${encodeURIComponent('pasaporte año 2026.png')}`,
    );
  });

  it('deleting removes the file and hides the document, keeping the audit trail', async () => {
    expect((await john.request('DELETE', `${docs(E('E001'))}/${documentId}`)).status).toBe(403);
    expect((await maria.request('DELETE', `${docs(E('E001'))}/${documentId}`)).status).toBe(204);
    expect((await maria.get(docs(E('E001')))).body.items).toEqual([]);
    expect((await download(maria, E('E001'), documentId)).status).toBe(404);
    expect((await maria.request('DELETE', `${docs(E('E001'))}/${documentId}`)).status).toBe(404);
    expect(
      existsSync(
        join(
          ctx.env.STORAGE_LOCAL_DIR,
          ctx.world.abc.organizationId,
          'employee-documents',
          documentId,
        ),
      ),
    ).toBe(false);
    const audit = await admin.get(`/api/v1/audit-logs?entityType=employee&entityId=${E('E001')}`);
    expect(audit.status).toBe(200);
    expect(audit.body.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        'employee.document_added',
        'employee.document_viewed',
        'employee.document_deleted',
      ]),
    );
  });
});

describe('document lifecycle (ADR-0021)', () => {
  const org = () => ({ organizationId: ctx.world.abc.organizationId, identityId: null });
  const runDaily = (localDate: string) =>
    ctx.app.get(TenantJobsProcessor).run({
      type: 'organization.daily-documents',
      organizationId: ctx.world.abc.organizationId,
      localDate,
    }) as Promise<{ swept: number; purged: number }>;
  const fileOf = (key: string) => join(ctx.env.STORAGE_LOCAL_DIR, ...key.split('/'));

  it('retention rules are organization settings for HR with organization scope', async () => {
    expect((await admin.get('/api/v1/document-retention')).body.rules).toMatchObject({
      CONTRACT: null,
      MEDICAL: null,
    });
    const rules = {
      CONTRACT: 60,
      GOVERNMENT_ID: 12,
      TAX: 120,
      MEDICAL: 12,
      CERTIFICATE: null,
      OTHER: null,
    };
    // Maria's HR grants are property-scoped: an organization policy is not hers to set.
    expect((await maria.request('PUT', '/api/v1/document-retention', { rules })).status).toBe(403);
    expect(
      (
        await admin.request('PUT', '/api/v1/document-retention', {
          rules: { ...rules, TAX: 0 },
        })
      ).status,
    ).toBe(400);
    const saved = await admin.request('PUT', '/api/v1/document-retention', { rules });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.rules).toEqual(rules);
  });

  it('documents of terminated employees are deleted when their retention runs out', async () => {
    const employee = E('E006');
    const id = (
      await upload(admin, employee, PNG, 'image/png', {
        category: 'GOVERNMENT_ID',
        title: 'ID card',
        fileName: 'id.png',
      })
    ).body.id as string;
    const cert = (
      await upload(admin, employee, PDF, 'application/pdf', {
        category: 'CERTIFICATE',
        title: 'Training',
      })
    ).body.id as string;
    expect((await admin.get(docs(employee))).body.items[0].purgeOn).toBeNull();

    const current = await admin.get(`/api/v1/employees/${employee}`);
    const terminated = await admin.request(
      'POST',
      `/api/v1/employees/${employee}/terminate`,
      { terminatedOn: '2026-10-31' },
      { 'if-match': String(current.headers.etag) },
    );
    expect(terminated.status, JSON.stringify(terminated.body)).toBe(200);
    const listed = (await admin.get(docs(employee))).body.items as {
      id: string;
      purgeOn: string | null;
    }[];
    // 12 months after 31 October: the last day of the target month, never a rollover.
    expect(listed.find((d) => d.id === id)!.purgeOn).toBe('2027-10-31');
    expect(listed.find((d) => d.id === cert)!.purgeOn).toBeNull();

    expect((await runDaily('2027-10-30')).purged).toBe(0);
    const result = await runDaily('2027-10-31');
    expect(result.purged).toBe(1);
    const after = (await admin.get(docs(employee))).body.items.map((d: { id: string }) => d.id);
    expect(after).toEqual([cert]);
    expect(existsSync(fileOf(`${ctx.world.abc.organizationId}/employee-documents/${id}`))).toBe(
      false,
    );
    const audit = await admin.get(`/api/v1/audit-logs?entityType=employee&entityId=${employee}`);
    expect(audit.body.items).toContainEqual(
      expect.objectContaining({ action: 'employee.document_expired', actorType: 'SYSTEM' }),
    );
  });

  it('sweeps uploads that never finished, and never hard-deletes a stored document', async () => {
    const app = createPrismaClient({ connectionString: testDatabaseUrls().app, maxConnections: 1 });
    const orgId = ctx.world.abc.organizationId;
    const stale = randomUUID();
    const fresh = randomUUID();
    try {
      await withDbContext(app, org(), async (tx) => {
        for (const [id, createdAt] of [
          [stale, new Date(Date.now() - 2 * 3_600_000)],
          [fresh, new Date()],
        ] as const) {
          await tx.employeeDocument.create({
            data: {
              id,
              organizationId: orgId,
              employeeId: E('E002'),
              category: 'OTHER',
              title: 'Interrupted',
              fileName: 'x.pdf',
              contentType: 'application/pdf',
              sizeBytes: PDF.length,
              sha256: createHash('sha256').update(PDF).digest('hex'),
              storageKey: `${orgId}/employee-documents/${id}`,
              createdAt,
            },
          });
        }
      });
      // The file of the stale upload made it to storage before the crash.
      const key = `${orgId}/employee-documents/${stale}`;
      await mkdir(dirname(fileOf(key)), { recursive: true });
      await writeFile(fileOf(key), PDF);
      // Pending uploads are invisible.
      const ids = (await maria.get(docs(E('E002')))).body.items.map((d: { id: string }) => d.id);
      expect(ids).not.toContain(stale);

      expect((await runDaily('2026-10-02')).swept).toBe(1);
      expect(existsSync(fileOf(key))).toBe(false);
      const left = await withDbContext(app, org(), (tx) =>
        tx.employeeDocument.findMany({ where: { id: { in: [stale, fresh] } } }),
      );
      expect(left.map((d) => d.id)).toEqual([fresh]);

      // Stored documents are only ever soft-deleted.
      const stored = (await maria.get(docs(E('E002')))).body.items[0].id as string;
      await expect(
        withDbContext(app, org(), (tx) => tx.employeeDocument.delete({ where: { id: stored } })),
      ).rejects.toThrow();
    } finally {
      await app.$disconnect();
    }
  });
});
