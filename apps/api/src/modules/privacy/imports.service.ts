import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  createGuestRequestSchema,
  IMPORT_COLUMNS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type CreateGuestRequest,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
} from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { parseCsv } from '../../common/csv.js';
import { ProblemException, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { CacheRedis } from '../../infrastructure/redis.js';
import { AuditService } from '../audit/audit.service.js';
import { refreshCapacity } from '../pms/inventory/inventory.js';
import { GuestsService } from '../pms/guests/guests.service.js';
import { businessDateOf } from '../pms/inventory/rooms.service.js';

const PLAN_TTL_SECONDS = 30 * 60;
const MAX_ERRORS = 200;
const SAMPLE_ROWS = 50;
const ROOM_NUMBER = /^[A-Za-z0-9-]{1,10}$/;

type RoomRow = { number: string; roomTypeId: string; roomTypeCode: string; notes: string };

/** A validated import waiting for its commit (Redis, one use). */
interface Plan {
  kind: ImportKind;
  propertyId: string;
  actorId: string | null;
  skipped: number;
  guests?: CreateGuestRequest[];
  rooms?: RoomRow[];
}

interface Row {
  row: number;
  values: Record<string, string>;
}

type Outcome<T> =
  | { status: 'NEW'; value: T; key: string }
  | { status: 'DUPLICATE' }
  | { status: 'ERROR'; errors: { column: string | null; message: string }[] };

const tooBig = () =>
  new ProblemException(413, 'VALIDATION_FAILED', 'File too large', 'At most 2 MiB and 5,000 rows.');

/**
 * CSV import with preview (spec §74, ADR-0030). A preview parses and validates every row
 * (tenant, property, required fields, types, duplicates) without writing anything, and
 * returns a one-time token. Committing the token creates exactly the previewed rows, in
 * one transaction. Nothing is imported while any row has an error; duplicates are skipped.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly redis: CacheRedis,
    private readonly guests: GuestsService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private get ctx() {
    return {
      organizationId: this.cls.get('organizationId')!,
      actorId: this.cls.get('identityId') ?? null,
    };
  }

  private planKey(token: string): string {
    return CacheRedis.tenantKey(this.ctx.organizationId, 'import', token);
  }

  /** Header and rows, with the kind's columns checked. */
  private read(kind: ImportKind, body: unknown): Row[] {
    const text =
      typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : '';
    if (!text.trim()) throw Problems.validation([{ path: 'body', message: 'The file is empty' }]);
    if (Buffer.byteLength(text) > IMPORT_MAX_BYTES) throw tooBig();
    let table: string[][];
    try {
      table = parseCsv(text);
    } catch (error) {
      throw Problems.validation([{ path: 'body', message: (error as Error).message }]);
    }
    const [header = [], ...data] = table;
    if (data.length > IMPORT_MAX_ROWS) throw tooBig();
    const columns = header.map((h) => h.trim().toLowerCase().replace(/\*$/, ''));
    const known = IMPORT_COLUMNS[kind].map((c) => c.replace(/\*$/, ''));
    const required = IMPORT_COLUMNS[kind].filter((c) => c.endsWith('*')).map((c) => c.slice(0, -1));
    const problems = [
      ...required.filter((c) => !columns.includes(c)).map((c) => `Missing column ${c}`),
      ...columns.filter((c) => !known.includes(c)).map((c) => `Unknown column ${c || '(blank)'}`),
    ];
    if (problems.length)
      throw Problems.validation(problems.map((message) => ({ path: 'header', message })));
    return data.map((cells, i) => ({
      // Row numbers as a spreadsheet shows them: the header is row 1.
      row: i + 2,
      values: Object.fromEntries(columns.map((c, j) => [c, (cells[j] ?? '').trim()])),
    }));
  }

  async preview(propertyId: string, kind: ImportKind, body: unknown): Promise<ImportPreview> {
    const rows = this.read(kind, body);
    const outcomes = await this.db.run<Outcome<CreateGuestRequest | RoomRow>[]>((tx) =>
      kind === 'guests' ? this.checkGuests(tx, rows) : this.checkRooms(tx, propertyId, rows),
    );

    const errors: ImportPreview['errors'] = [];
    let newRows = 0;
    let duplicateRows = 0;
    let errorRows = 0;
    const sample: ImportPreview['sample'] = [];
    outcomes.forEach((o, i) => {
      const { row, values } = rows[i]!;
      if (o.status === 'NEW') newRows++;
      else if (o.status === 'DUPLICATE') duplicateRows++;
      else {
        errorRows++;
        for (const e of o.errors)
          if (errors.length < MAX_ERRORS)
            errors.push({ row, column: e.column, message: e.message });
      }
      if (sample.length < SAMPLE_ROWS) sample.push({ row, status: o.status, values });
    });

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + PLAN_TTL_SECONDS * 1000);
    if (errorRows === 0) {
      const fresh = outcomes.filter(
        (o): o is Extract<typeof o, { status: 'NEW' }> => o.status === 'NEW',
      );
      const plan: Plan = {
        kind,
        propertyId,
        actorId: this.ctx.actorId,
        skipped: duplicateRows,
        ...(kind === 'guests'
          ? { guests: fresh.map((o) => o.value as CreateGuestRequest) }
          : { rooms: fresh.map((o) => o.value as RoomRow) }),
      };
      await this.redis.client.set(
        this.planKey(token),
        JSON.stringify(plan),
        'EX',
        PLAN_TTL_SECONDS,
      );
    }
    return {
      token: errorRows === 0 ? token : '',
      kind,
      expiresAt: expiresAt.toISOString(),
      totalRows: rows.length,
      newRows,
      duplicateRows,
      errorRows,
      errors,
      sample,
    };
  }

  private async checkGuests(tx: Tx, rows: Row[]): Promise<Outcome<CreateGuestRequest>[]> {
    const emails = rows.map((r) => r.values.email?.toLowerCase()).filter((e): e is string => !!e);
    const existing = new Set(
      (
        await tx.guest.findMany({
          where: { email: { in: emails }, archivedAt: null },
          select: { email: true },
        })
      ).map((g) => g.email!.toLowerCase()),
    );
    const seen = new Set<string>();
    return rows.map(({ values }) => {
      const parsed = createGuestRequestSchema.safeParse({
        firstName: values.first_name ?? '',
        lastName: values.last_name ?? '',
        email: values.email || null,
        phone: values.phone || null,
        countryCode: values.country_code ? values.country_code.toUpperCase() : null,
        notes: values.notes ?? '',
      });
      if (!parsed.success)
        return {
          status: 'ERROR',
          errors: parsed.error.issues.map((issue) => ({
            column: COLUMN_OF[String(issue.path[0])] ?? null,
            message: issue.message,
          })),
        };
      const key = parsed.data.email?.toLowerCase() ?? '';
      if (key && (existing.has(key) || seen.has(key))) return { status: 'DUPLICATE' };
      if (key) seen.add(key);
      return { status: 'NEW', value: parsed.data, key };
    });
  }

  private async checkRooms(tx: Tx, propertyId: string, rows: Row[]): Promise<Outcome<RoomRow>[]> {
    const types = await tx.roomType.findMany({
      where: { propertyId, archivedAt: null },
      select: { id: true, code: true },
    });
    const byCode = new Map(types.map((t) => [t.code.toUpperCase(), t.id]));
    const existing = new Set(
      (await tx.room.findMany({ where: { propertyId }, select: { number: true } })).map((r) =>
        r.number.toUpperCase(),
      ),
    );
    const seen = new Set<string>();
    return rows.map(({ values }) => {
      const errors: { column: string; message: string }[] = [];
      const number = values.number ?? '';
      const code = (values.room_type ?? '').toUpperCase();
      const notes = values.notes ?? '';
      if (!ROOM_NUMBER.test(number))
        errors.push({ column: 'number', message: 'Letters, digits and - (1-10 characters)' });
      const roomTypeId = byCode.get(code);
      if (!code) errors.push({ column: 'room_type', message: 'Required' });
      else if (!roomTypeId)
        errors.push({ column: 'room_type', message: `No room type ${code} here` });
      if (notes.length > 500) errors.push({ column: 'notes', message: 'At most 500 characters' });
      if (errors.length) return { status: 'ERROR', errors };
      const key = number.toUpperCase();
      if (existing.has(key) || seen.has(key)) return { status: 'DUPLICATE' };
      seen.add(key);
      return {
        status: 'NEW',
        value: { number, roomTypeId: roomTypeId!, roomTypeCode: code, notes },
        key,
      };
    });
  }

  /** Creates the previewed rows; the token works once and only for whoever previewed. */
  async commit(propertyId: string, kind: ImportKind, token: string): Promise<ImportResult> {
    const expired = () =>
      new ProblemException(
        410,
        'NOT_FOUND',
        'Preview expired',
        'This preview was already used or has expired. Upload the file again.',
      );
    const key = this.planKey(token);
    const raw = await this.redis.client.get(key);
    const plan = raw ? (JSON.parse(raw) as Plan) : null;
    if (
      !plan ||
      plan.kind !== kind ||
      plan.propertyId !== propertyId ||
      plan.actorId !== this.ctx.actorId
    )
      throw expired();
    // Used once: of two concurrent commits, only one deletes the plan.
    if ((await this.redis.client.del(key)) !== 1) throw expired();
    return this.db.run(async (tx) => {
      let created = 0;
      let skipped = plan.skipped;
      if (plan.kind === 'guests') {
        // Someone may have added the same guests since the preview.
        const emails = plan.guests!.map((g) => g.email).filter((e): e is string => !!e);
        const taken = new Set(
          (
            await tx.guest.findMany({
              where: { email: { in: emails }, archivedAt: null },
              select: { email: true },
            })
          ).map((g) => g.email!.toLowerCase()),
        );
        for (const guest of plan.guests!) {
          if (guest.email && taken.has(guest.email.toLowerCase())) {
            skipped++;
            continue;
          }
          await this.guests.createInTx(tx, propertyId, guest);
          created++;
        }
      } else {
        const taken = new Set(
          (await tx.room.findMany({ where: { propertyId }, select: { number: true } })).map((r) =>
            r.number.toUpperCase(),
          ),
        );
        const { organizationId, actorId } = this.ctx;
        for (const room of plan.rooms!) {
          if (taken.has(room.number.toUpperCase())) {
            skipped++;
            continue;
          }
          await tx.room.create({
            data: {
              organizationId,
              propertyId,
              number: room.number,
              roomTypeId: room.roomTypeId,
              notes: room.notes,
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
          created++;
        }
        const today = await businessDateOf(tx, propertyId);
        for (const roomTypeId of new Set(plan.rooms!.map((r) => r.roomTypeId)))
          await refreshCapacity(tx, roomTypeId, today);
      }
      await this.audit.record(tx, {
        action: 'import.committed',
        entityType: 'import',
        propertyId,
        after: { kind, created, skipped },
      });
      return { kind, created, skipped };
    });
  }
}

const COLUMN_OF: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  countryCode: 'country_code',
  notes: 'notes',
};
