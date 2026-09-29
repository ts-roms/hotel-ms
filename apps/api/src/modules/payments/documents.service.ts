import { Injectable } from '@nestjs/common';
import type { FolioDocument, IssueDocumentRequest } from '@hotel/contracts';
import type { Prisma } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate } from '../../common/dates.js';
import { toMinor } from '../../common/money.js';
import { nextNumber } from '../../common/numbering.js';
import { Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

const signed = (v: bigint) => (v < 0n ? -toMinor(-v) : toMinor(v));
const PREFIX = { INVOICE: 'INV', RECEIPT: 'RCT' } as const;

type DocumentRow = Prisma.FolioDocumentGetPayload<object>;

function toDto(d: DocumentRow): FolioDocument {
  return {
    id: d.id,
    folioId: d.folioId,
    type: d.type,
    documentNo: d.documentNo,
    paymentId: d.paymentId,
    issuedAt: d.issuedAt.toISOString(),
    currency: d.currency,
    totalMinor: signed(d.totalMinor),
    content: d.content as FolioDocument['content'],
  };
}

/**
 * Invoices and receipts (blueprint §15.1): immutable snapshots with a gap-free number per
 * property and type. The number comes from a row-locked counter in the issuing
 * transaction, so a rolled-back issue never leaves a gap. Not BIR-accredited (ADR-0016).
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async issue(
    propertyId: string,
    folioId: string,
    input: IssueDocumentRequest,
  ): Promise<FolioDocument> {
    const organizationId = this.cls.get('organizationId')!;
    return this.db.run(async (tx) => {
      const folio = await tx.folio.findFirst({
        where: { id: folioId, propertyId },
        include: {
          lines: { orderBy: [{ postedAt: 'asc' }, { id: 'asc' }] },
          reservationRoom: { include: { guest: { select: { firstName: true, lastName: true } } } },
        },
      });
      if (!folio) throw Problems.notFound('Folio');
      let payment: Prisma.PaymentGetPayload<object> | null = null;
      if (input.type === 'RECEIPT') {
        payment = await tx.payment.findFirst({ where: { id: input.paymentId, folioId } });
        if (!payment)
          throw Problems.validation([
            { path: 'paymentId', message: 'Not a payment of this folio' },
          ]);
        // One receipt per payment: asking again returns it.
        const existing = await tx.folioDocument.findFirst({
          where: { paymentId: payment.id, type: 'RECEIPT' },
        });
        if (existing) return toDto(existing);
      }
      const property = await tx.property.findUniqueOrThrow({
        where: { id: propertyId },
        select: { name: true, addressLine1: true, city: true },
      });
      const taxNames = new Map(
        (
          await tx.taxRule.findMany({ where: { propertyId }, select: { code: true, name: true } })
        ).map((t) => [t.code, t.name]),
      );
      const taxes = new Map<string, bigint>();
      const lines: FolioDocument['content']['lines'] = [];
      let charges = 0n;
      let payments = 0n;
      for (const l of folio.lines) {
        if (l.taxCode) taxes.set(l.taxCode, (taxes.get(l.taxCode) ?? 0n) + l.amountMinor);
        if (l.type === 'PAYMENT' || l.type === 'REFUND') payments -= l.amountMinor;
        else charges += l.amountMinor;
        if (l.type !== 'TAX') {
          lines.push({
            date: fromDbDate(l.businessDate),
            type: l.type,
            description: l.description,
            amountMinor: signed(l.amountMinor),
          });
        }
      }
      const guest = folio.reservationRoom?.guest;
      const content: FolioDocument['content'] = {
        property: {
          name: property.name,
          address: [property.addressLine1, property.city].filter(Boolean).join(', ') || null,
        },
        billTo: folio.label ?? (guest ? `${guest.firstName} ${guest.lastName}` : folio.folioNo),
        folioNo: folio.folioNo,
        lines,
        taxes: [...taxes].map(([code, amount]) => ({
          code,
          name: taxNames.get(code) ?? code,
          amountMinor: signed(amount),
        })),
        totals: {
          chargesMinor: signed(charges),
          paymentsMinor: signed(payments),
          balanceMinor: signed(folio.balanceMinor),
        },
        payment: payment
          ? {
              method: payment.method,
              amountMinor: toMinor(payment.amountMinor),
              reference: payment.reference,
            }
          : null,
      };
      const n = await nextNumber(
        tx,
        organizationId,
        propertyId,
        input.type === 'INVOICE' ? 'invoice' : 'receipt',
      );
      const document = await tx.folioDocument.create({
        data: {
          organizationId,
          propertyId,
          folioId,
          type: input.type,
          documentNo: `${PREFIX[input.type]}-${String(n).padStart(6, '0')}`,
          paymentId: payment?.id ?? null,
          currency: folio.currency,
          totalMinor: payment ? payment.amountMinor : charges,
          content: content as unknown as Prisma.InputJsonValue,
          issuedBy: this.cls.get('identityId') ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'document.issued',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { documentId: document.id, type: document.type, documentNo: document.documentNo },
      });
      await this.outbox.enqueue(
        tx,
        'DocumentIssued',
        { documentId: document.id, type: document.type, documentNo: document.documentNo },
        { propertyId },
      );
      return toDto(document);
    });
  }

  async list(propertyId: string, folioId: string): Promise<FolioDocument[]> {
    const rows = await this.db.run((tx) =>
      tx.folioDocument.findMany({ where: { folioId, propertyId }, orderBy: { issuedAt: 'desc' } }),
    );
    return rows.map(toDto);
  }

  async get(propertyId: string, id: string): Promise<FolioDocument> {
    const row = await this.db.run((tx) =>
      tx.folioDocument.findFirst({ where: { id, propertyId } }),
    );
    if (!row) throw Problems.notFound('Document');
    return toDto(row);
  }
}
