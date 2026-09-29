import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AnonymizeResult } from '@hotel/contracts';
import type { Tx } from '@hotel/database';
import { ClsService } from 'nestjs-cls';
import { fromDbDate } from '../../common/dates.js';
import { invalidState, Problems } from '../../common/problem.js';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../infrastructure/storage.js';
import { AuditService } from '../audit/audit.service.js';

const money = (minor: bigint) => Number(minor) / 100;
const day = (d: Date | null) => (d ? fromDbDate(d) : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Data requests (spec §45, ADR-0030): everything the organization holds about one guest
 * or one employee, as a JSON export; and anonymization where the law allows it.
 *
 * Anonymizing removes the person's identity from their profile and free text, deletes their
 * files (IDs, documents, selfies) and ends their sessions. It keeps what the law makes the
 * hotel keep: folios, payments, invoices and receipts (tax), attendance and pay (labor), and
 * the audit log. Those records then point at a profile that no longer names anyone. Staff
 * with privacy.manage (sensitive: two-step verification) do this, with a reason.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private get actorId() {
    return this.cls.get('identityId') ?? null;
  }

  // ---- Guests ------------------------------------------------------------------------------

  private async requireGuest(tx: Tx, guestId: string) {
    const guest = await tx.guest.findUnique({ where: { id: guestId } });
    if (!guest) throw Problems.notFound('Guest');
    return guest;
  }

  async exportGuest(guestId: string): Promise<Record<string, unknown>> {
    return this.db.run(async (tx) => {
      const g = await this.requireGuest(tx, guestId);
      const lines = await tx.reservationRoom.findMany({
        where: { OR: [{ guestId }, { reservation: { bookerGuestId: guestId } }] },
        include: {
          reservation: true,
          roomType: { select: { name: true } },
          stays: { include: { room: { select: { number: true } } } },
          folios: {
            include: {
              lines: { orderBy: { postedAt: 'asc' } },
              payments: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
        orderBy: { arrivalDate: 'asc' },
      });
      const lineIds = lines.map((l) => l.id);
      const [requests, orders, notifications, ids, history] = await Promise.all([
        tx.serviceRequest.findMany({ where: { guestId }, orderBy: { createdAt: 'asc' } }),
        tx.order.findMany({
          where: { guestId },
          include: { items: true },
          orderBy: { createdAt: 'asc' },
        }),
        tx.guestNotification.findMany({
          where: { reservationRoomId: { in: lineIds } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.guestIdentityDocument.findMany({ where: { guestId }, orderBy: { uploadedAt: 'asc' } }),
        tx.auditLog.findMany({
          where: { entityType: 'guest', entityId: guestId },
          select: { action: true, occurredAt: true },
          orderBy: { occurredAt: 'asc' },
        }),
      ]);
      await this.audit.record(tx, {
        action: 'privacy.guest_exported',
        entityType: 'guest',
        entityId: guestId,
      });
      return {
        exportedAt: new Date().toISOString(),
        subject: 'guest',
        profile: {
          id: g.id,
          firstName: g.firstName,
          lastName: g.lastName,
          email: g.email,
          phone: g.phone,
          countryCode: g.countryCode,
          notes: g.notes,
          createdAt: g.createdAt.toISOString(),
          archivedAt: iso(g.archivedAt),
        },
        stays: lines.map((l) => ({
          confirmationNo: l.reservation.confirmationNo,
          asBooker: l.reservation.bookerGuestId === guestId,
          asGuest: l.guestId === guestId,
          status: l.status,
          arrivalDate: day(l.arrivalDate),
          departureDate: day(l.departureDate),
          roomType: l.roomType.name,
          adults: l.adults,
          children: l.children,
          expectedArrivalTime: l.expectedArrivalTime,
          specialRequests: l.reservation.specialRequests,
          notes: l.reservation.notes,
          rooms: l.stays.map((s) => ({
            room: s.room.number,
            checkedInAt: iso(s.checkedInAt),
            checkedOutAt: iso(s.checkedOutAt),
          })),
          folios: l.folios.map((f) => ({
            currency: f.currency,
            status: f.status,
            charges: f.lines.map((x) => ({
              date: day(x.businessDate),
              description: x.description,
              amount: money(x.amountMinor),
            })),
            payments: f.payments.map((p) => ({
              date: day(p.businessDate),
              method: p.method,
              amount: money(p.amountMinor),
              currency: p.currency,
            })),
          })),
        })),
        serviceRequests: requests.map((r) => ({
          requestNo: r.requestNo,
          category: r.category,
          description: r.description,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          rating: r.rating,
          feedback: r.feedback,
        })),
        orders: orders.map((o) => ({
          orderNo: o.orderNo,
          status: o.status,
          createdAt: o.createdAt.toISOString(),
          currency: o.currency,
          total: money(o.totalMinor),
          notes: o.notes,
          items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, notes: i.notes })),
        })),
        notifications: notifications.map((n) => ({
          title: n.title,
          body: n.body,
          createdAt: n.createdAt.toISOString(),
        })),
        identityDocuments: ids.map((d) => ({
          documentType: d.documentType,
          status: d.status,
          uploadedAt: d.uploadedAt.toISOString(),
          reviewedAt: iso(d.reviewedAt),
          fileDeletedAt: iso(d.purgedAt),
        })),
        profileHistory: history.map((h) => ({ action: h.action, at: h.occurredAt.toISOString() })),
      };
    });
  }

  async anonymizeGuest(guestId: string, reason: string): Promise<AnonymizeResult> {
    const now = new Date();
    const { files, summary } = await this.db.run(async (tx) => {
      const guest = await this.requireGuest(tx, guestId);
      if (guest.firstName === 'Anonymized' && guest.email === null && guest.archivedAt)
        throw invalidState('This guest is already anonymized.');
      const active = await tx.reservationRoom.count({
        where: {
          status: { in: ['RESERVED', 'IN_HOUSE'] },
          OR: [{ guestId }, { reservation: { bookerGuestId: guestId, status: 'CONFIRMED' } }],
        },
      });
      if (active > 0)
        throw invalidState('The guest has an upcoming or current stay. Anonymize after it ends.');

      await tx.guest.update({
        where: { id: guestId },
        data: {
          firstName: 'Anonymized',
          lastName: 'Guest',
          email: null,
          phone: null,
          countryCode: null,
          notes: '',
          archivedAt: guest.archivedAt ?? now,
          updatedBy: this.actorId,
          version: { increment: 1 },
        },
      });
      const reservations = await tx.reservation.updateMany({
        where: { bookerGuestId: guestId },
        data: { specialRequests: '', notes: '' },
      });
      const requests = await tx.serviceRequest.updateMany({
        where: { guestId },
        data: { description: '', feedback: null },
      });
      const lines = await tx.reservationRoom.findMany({ where: { guestId }, select: { id: true } });
      const lineIds = lines.map((l) => l.id);
      await tx.guestSession.updateMany({
        where: { guestId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.guestPortalLink.updateMany({
        where: { reservation: { bookerGuestId: guestId }, revokedAt: null },
        data: { revokedAt: now },
      });
      const docs = await tx.guestIdentityDocument.findMany({
        where: { guestId, purgedAt: null },
        select: { id: true, storageKey: true },
      });
      if (docs.length)
        await tx.guestIdentityDocument.updateMany({
          where: { id: { in: docs.map((d) => d.id) } },
          data: { purgedAt: now, version: { increment: 1 } },
        });
      const summary = {
        profile: 1,
        reservationsCleared: reservations.count,
        serviceRequestsCleared: requests.count,
        stays: lineIds.length,
        idFilesDeleted: docs.length,
      };
      // The reason and what was done; never the personal data itself.
      await this.audit.record(tx, {
        action: 'privacy.guest_anonymized',
        entityType: 'guest',
        entityId: guestId,
        after: { reason, ...summary },
      });
      return { files: docs.map((d) => d.storageKey), summary };
    });
    await this.deleteFiles(files);
    return { anonymizedAt: now.toISOString(), summary };
  }

  // ---- Employees ---------------------------------------------------------------------------

  private async requireEmployee(tx: Tx, employeeId: string) {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw Problems.notFound('Employee');
    return employee;
  }

  async exportEmployee(employeeId: string): Promise<Record<string, unknown>> {
    return this.db.run(async (tx) => {
      const e = await this.requireEmployee(tx, employeeId);
      const [assignments, shifts, punches, leave, ledger, documents, trainings, reviews, pay] =
        await Promise.all([
          tx.employmentAssignment.findMany({
            where: { employeeId },
            include: {
              property: { select: { name: true } },
              department: { select: { name: true } },
              position: { select: { name: true } },
            },
            orderBy: { startDate: 'asc' },
          }),
          tx.shift.findMany({ where: { employeeId }, orderBy: { startsAt: 'asc' } }),
          tx.attendancePunch.findMany({ where: { employeeId }, orderBy: { at: 'asc' } }),
          tx.leaveRequest.findMany({
            where: { employeeId },
            include: { leaveType: { select: { name: true } } },
            orderBy: { startDate: 'asc' },
          }),
          tx.leaveLedgerEntry.findMany({
            where: { employeeId },
            orderBy: { effectiveDate: 'asc' },
          }),
          tx.employeeDocument.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } }),
          tx.employeeTraining.findMany({ where: { employeeId }, orderBy: { createdAt: 'asc' } }),
          tx.employeeReview.findMany({ where: { employeeId }, orderBy: { reviewDate: 'asc' } }),
          tx.employeeCompensation.findMany({
            where: { employeeId },
            orderBy: { effectiveFrom: 'asc' },
          }),
        ]);
      await this.audit.record(tx, {
        action: 'privacy.employee_exported',
        entityType: 'employee',
        entityId: employeeId,
      });
      return {
        exportedAt: new Date().toISOString(),
        subject: 'employee',
        profile: {
          id: e.id,
          employeeNo: e.employeeNo,
          firstName: e.firstName,
          lastName: e.lastName,
          preferredName: e.preferredName,
          workEmail: e.workEmail,
          workPhone: e.workPhone,
          personalEmail: e.personalEmail,
          personalPhone: e.personalPhone,
          birthDate: day(e.birthDate),
          emergencyContact: e.emergencyContactName
            ? {
                name: e.emergencyContactName,
                relationship: e.emergencyContactRelationship,
                phone: e.emergencyContactPhone,
              }
            : null,
          employmentType: e.employmentType,
          hireDate: day(e.hireDate),
          status: e.status,
          terminatedOn: day(e.terminatedOn),
        },
        assignments: assignments.map((a) => ({
          property: a.property.name,
          department: a.department.name,
          position: a.position?.name ?? null,
          startDate: day(a.startDate),
          endDate: day(a.endDate),
        })),
        shifts: shifts.map((s) => ({
          date: day(s.shiftDate),
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          status: s.status,
        })),
        attendance: punches.map((p) => ({
          type: p.type,
          at: p.at.toISOString(),
          source: p.source,
        })),
        leaveRequests: leave.map((l) => ({
          type: l.leaveType.name,
          startDate: day(l.startDate),
          endDate: day(l.endDate),
          status: l.status,
          reason: l.reason,
        })),
        leaveLedger: ledger.map((l) => ({
          kind: l.kind,
          days: l.halfDays / 2,
          effectiveDate: day(l.effectiveDate),
          note: l.note,
        })),
        documents: documents.map((d) => ({
          category: d.category,
          title: d.title,
          fileName: d.fileName,
          uploadedAt: d.createdAt.toISOString(),
          deletedAt: iso(d.deletedAt),
        })),
        trainings: trainings.map((t) => ({
          kind: t.kind,
          title: t.title,
          provider: t.provider,
          completedOn: day(t.completedOn),
          expiresOn: day(t.expiresOn),
        })),
        performanceReviews: reviews.map((r) => ({
          reviewDate: day(r.reviewDate),
          rating: r.rating,
          summary: r.summary,
          strengths: r.strengths,
          improvements: r.improvements,
          goals: r.goals,
        })),
        pay: pay.map((c) => ({
          effectiveFrom: day(c.effectiveFrom),
          payBasis: c.payBasis,
          amount: money(c.amountMinor),
          currency: c.currency,
        })),
      };
    });
  }

  /**
   * Only for people who have left: their name and personal details go, documents and
   * selfies are deleted, their login is unlinked. Attendance, pay and reviews stay for the
   * labor-law retention period, attached to "Former employee <number>".
   */
  async anonymizeEmployee(employeeId: string, reason: string): Promise<AnonymizeResult> {
    const now = new Date();
    const { files, summary } = await this.db.run(async (tx) => {
      const e = await this.requireEmployee(tx, employeeId);
      if (e.status !== 'TERMINATED')
        throw invalidState('Only employees who have left can be anonymized.');
      if (e.firstName === 'Former' && e.personalEmail === null && e.birthDate === null)
        throw invalidState('This employee is already anonymized.');
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          firstName: 'Former',
          lastName: `employee ${e.employeeNo}`,
          preferredName: null,
          workEmail: null,
          workPhone: null,
          personalEmail: null,
          personalPhone: null,
          birthDate: null,
          birthdayVisibility: 'HIDDEN',
          emergencyContactName: null,
          emergencyContactRelationship: null,
          emergencyContactPhone: null,
          membershipId: null,
          version: { increment: 1 },
        },
      });
      const documents = await tx.employeeDocument.findMany({
        where: { employeeId, deletedAt: null, storedAt: { not: null } },
        select: { id: true, storageKey: true },
      });
      if (documents.length)
        await tx.employeeDocument.updateMany({
          where: { id: { in: documents.map((d) => d.id) } },
          data: { deletedAt: now, deletedBy: this.actorId, deletionReason: 'USER' },
        });
      const photos = await tx.attendancePhoto.findMany({
        where: { deletedAt: null, punch: { employeeId } },
        select: { punchId: true, storageKey: true },
      });
      if (photos.length)
        await tx.attendancePhoto.updateMany({
          where: { punchId: { in: photos.map((p) => p.punchId) } },
          data: { deletedAt: now },
        });
      const summary = {
        profile: 1,
        documentsDeleted: documents.length,
        selfiesDeleted: photos.length,
      };
      await this.audit.record(tx, {
        action: 'privacy.employee_anonymized',
        entityType: 'employee',
        entityId: employeeId,
        after: { reason, ...summary },
      });
      return {
        files: [...documents.map((d) => d.storageKey), ...photos.map((p) => p.storageKey)],
        summary,
      };
    });
    await this.deleteFiles(files);
    return { anonymizedAt: now.toISOString(), summary };
  }

  private async deleteFiles(keys: string[]): Promise<void> {
    for (const key of keys)
      await this.storage.delete(key).catch((error: unknown) => {
        this.logger.error(`Could not delete file ${key}: ${String(error)}`);
      });
  }
}
