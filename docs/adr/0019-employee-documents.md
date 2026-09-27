# ADR-0019: Employee documents in object storage

- Status: Accepted, 2026-09-28
- Blueprint: §13.1 (employee records), §20 (security), §21 (infrastructure)

## Decision

**Files live in object storage; the database holds the metadata.**

- `employee_documents` is tenant-scoped with RLS like every tenant table. The runtime role
  may insert rows and set `deleted_at` / `deleted_by`, nothing else; metadata is never
  edited. Each row holds:
  - category (contract, government ID, tax, medical, certificate, other);
  - title, original file name, content type and size;
  - SHA-256, optional expiry date, uploader;
  - the storage key.
- The storage port (`infrastructure/storage.ts`) has two drivers, and production refuses
  the local one:
  - **local** disk: development and tests;
  - **S3**: the cloud. Every object is encrypted with the platform KMS key (SSE-KMS,
    bucket key), and S3 verifies each upload against our SHA-256.
- Keys are opaque and built by the API: `{organizationId}/employee-documents/{documentId}`.
  They contain no names or file names. The local driver rejects anything else, so a
  key can never escape its directory.

**Access.**

- One permission, `employee.documents`, marked **sensitive**: it needs an MFA-verified
  session (ADR-0006). HR managers get it from the role template.
- Its scope works like other employee data (ADR-0014). An organization grant covers
  everyone; a property grant covers employees assigned there. Employees outside scope,
  and other tenants' employees, answer 404.
- Every upload, **every view** and every deletion is audited.

**Uploads.**

- The request body is the file itself, with its Content-Type. Metadata travels in the
  query string. There is no multipart parsing.
- Accepted types are PDF, JPEG, PNG and WebP, up to 8 MiB (a per-type body limit in
  Fastify). The web proxy buffers up to 10 MB.
- The file's own bytes must match the claimed type (magic numbers). An HTML file posted
  as `application/pdf` is refused with 415 `UNSUPPORTED_FILE_TYPE`.
- The object is written first, then the row. If the row fails, the object is removed.
  A crash in between can leave an unreferenced object, never a row without a file.

**Downloads** are streamed through the API (no presigned URLs). This keeps the permission
check and the audit on every read. The response always has these headers:

- `Content-Disposition: attachment` (RFC 6266, with a UTF-8 name);
- `Cache-Control: private, no-store`;
- `Content-Security-Policy: sandbox`.

The browser therefore never renders a document as a page of our origin.

**Deletion** soft-deletes the row, which stays for the audit trail, and deletes the
object. The bucket is versioned, so the file stays recoverable for
`deleted_document_retention_days` (30 by default), then expires.

**Infrastructure** (`modules/platform/storage.tf`):

- a private bucket: owner-enforced, public access blocked, default SSE-KMS, versioned;
- a bucket policy that refuses non-TLS requests and objects under any other KMS key;
- the API task role alone may put, get and delete objects, and use the key only through
  S3. Nothing may list the bucket.

## Consequences

- Documents cost an API round trip on download, which is fine at HR volumes. Presigned
  URLs would skip the per-view audit, so they stay out.
- A periodic sweep of unreferenced objects (written, then the row failed) is a possible
  follow-up. They are rare and never reachable through the API.
- Retention rules per document category (for example, keep payroll records N years) are
  not enforced yet. HR deletes by hand, and every deletion is audited.
