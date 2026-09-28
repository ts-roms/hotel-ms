import { Injectable } from '@nestjs/common';
import type {
  Compensation,
  CompensationHistory,
  CreateCompensationRequest,
  CreatePerformanceReviewRequest,
  CreateTrainingRequest,
  PerformanceReview,
  PermissionCode,
  TrainingRecord,
} from '@hotel/contracts';
import type { Prisma, Tx } from '@hotel/database';
import { addDays, fromDbDate, toDbDate } from '../../common/dates.js';
import { Problems } from '../../common/problem.js';
import { localToday } from '../../common/zoned-time.js';
import { TenantDb } from '../../infrastructure/database.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toMinor } from '../pms/pricing.js';
import { employeeName, HrAccess } from './hr-access.js';

/** A certification counts as expiring this many days ahead. */
export const EXPIRY_WARNING_DAYS = 30;

type TrainingRow = Prisma.EmployeeTrainingGetPayload<object>;

/**
 * The parts of an employee's file beyond the profile (spec §33, ADR-0028): pay history
 * (employee.compensation), trainings and certifications (employee.read to see,
 * employee.manage to record), and performance reviews (employee.performance). Pay and
 * reviews are never edited; a correction is a new record. Every call is scoped to
 * employees the permission covers; others are 404s.
 */
@Injectable()
export class ProfileRecordsService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly audit: AuditService,
    private readonly inbox: NotificationsService,
  ) {}

  private async require(tx: Tx, permission: PermissionCode, employeeId: string) {
    return this.access.requireEmployee(tx, permission, employeeId);
  }

  /** Today in the organization's default time zone. */
  private async today(tx: Tx): Promise<string> {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: this.access.organizationId },
      select: { defaultTimezone: true },
    });
    return localToday(org.defaultTimezone);
  }

  private async identityNames(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => !!i))];
    if (unique.length === 0) return new Map();
    const rows = await tx.identity.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  // ---- Compensation ------------------------------------------------------------------------

  async compensation(employeeId: string): Promise<CompensationHistory> {
    return this.db.run(async (tx) => {
      await this.require(tx, 'employee.compensation', employeeId);
      const today = await this.today(tx);
      const rows = await tx.employeeCompensation.findMany({
        where: { employeeId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      });
      const names = await this.identityNames(
        tx,
        rows.map((r) => r.createdBy),
      );
      const history: Compensation[] = rows.map((r) => ({
        id: r.id,
        effectiveFrom: fromDbDate(r.effectiveFrom),
        payBasis: r.payBasis as Compensation['payBasis'],
        amountMinor: toMinor(r.amountMinor),
        currency: r.currency,
        notes: r.notes,
        createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      }));
      return { current: history.find((c) => c.effectiveFrom <= today) ?? null, history };
    });
  }

  async addCompensation(
    employeeId: string,
    input: CreateCompensationRequest,
  ): Promise<CompensationHistory> {
    await this.db.run(async (tx) => {
      await this.require(tx, 'employee.compensation', employeeId);
      const row = await tx.employeeCompensation.create({
        data: {
          organizationId: this.access.organizationId,
          employeeId,
          effectiveFrom: toDbDate(input.effectiveFrom),
          payBasis: input.payBasis,
          amountMinor: BigInt(input.amountMinor),
          currency: input.currency,
          notes: input.notes,
          createdBy: this.access.actorId,
        },
      });
      // Amounts stay out of the audit log; it records that pay changed, and from when.
      await this.audit.record(tx, {
        action: 'employee.compensation_recorded',
        entityType: 'employee',
        entityId: employeeId,
        after: { recordId: row.id, effectiveFrom: input.effectiveFrom, payBasis: input.payBasis },
      });
    });
    return this.compensation(employeeId);
  }

  // ---- Training and certifications ---------------------------------------------------------

  private toTraining(r: TrainingRow, today: string): TrainingRecord {
    const expiresOn = r.expiresOn ? fromDbDate(r.expiresOn) : null;
    return {
      id: r.id,
      kind: r.kind as TrainingRecord['kind'],
      title: r.title,
      provider: r.provider,
      completedOn: r.completedOn ? fromDbDate(r.completedOn) : null,
      expiresOn,
      expiry: !expiresOn
        ? null
        : expiresOn < today
          ? 'EXPIRED'
          : expiresOn <= addDays(today, EXPIRY_WARNING_DAYS)
            ? 'EXPIRING'
            : 'VALID',
      notes: r.notes,
      documentId: r.documentId,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async trainings(employeeId: string): Promise<TrainingRecord[]> {
    return this.db.run(async (tx) => {
      await this.require(tx, 'employee.read', employeeId);
      const today = await this.today(tx);
      const rows = await tx.employeeTraining.findMany({
        where: { employeeId },
        orderBy: [{ completedOn: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      });
      return rows.map((r) => this.toTraining(r, today));
    });
  }

  private async requireManage(tx: Tx, employeeId: string) {
    await this.require(tx, 'employee.read', employeeId);
    if (!(await this.access.coversEmployee(tx, 'employee.manage', employeeId)))
      throw Problems.forbidden('Missing permission employee.manage');
  }

  async addTraining(employeeId: string, input: CreateTrainingRequest): Promise<TrainingRecord[]> {
    await this.db.run(async (tx) => {
      await this.requireManage(tx, employeeId);
      if (
        input.documentId &&
        !(await tx.employeeDocument.count({
          where: { id: input.documentId, employeeId, storedAt: { not: null } },
        }))
      ) {
        throw Problems.validation([
          { path: 'documentId', message: "Not one of the employee's documents" },
        ]);
      }
      const row = await tx.employeeTraining.create({
        data: {
          organizationId: this.access.organizationId,
          employeeId,
          kind: input.kind,
          title: input.title,
          provider: input.provider,
          completedOn: input.completedOn ? toDbDate(input.completedOn) : null,
          expiresOn: input.expiresOn ? toDbDate(input.expiresOn) : null,
          notes: input.notes,
          documentId: input.documentId,
          createdBy: this.access.actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'employee.training_recorded',
        entityType: 'employee',
        entityId: employeeId,
        after: { recordId: row.id, kind: input.kind, title: input.title },
      });
    });
    return this.trainings(employeeId);
  }

  async removeTraining(employeeId: string, id: string): Promise<void> {
    await this.db.run(async (tx) => {
      await this.requireManage(tx, employeeId);
      const row = await tx.employeeTraining.findFirst({ where: { id, employeeId } });
      if (!row) throw Problems.notFound('Training record');
      await tx.employeeTraining.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'employee.training_removed',
        entityType: 'employee',
        entityId: employeeId,
        before: { recordId: id, kind: row.kind, title: row.title },
      });
    });
  }

  /**
   * Daily (organization job): certifications expiring in EXPIRY_WARNING_DAYS days, or today,
   * are announced to HR at the employee's properties and to the employee. Each is sent once.
   */
  async remindExpiring(today: string): Promise<number> {
    const soon = addDays(today, EXPIRY_WARNING_DAYS);
    return this.db.run(async (tx) => {
      const rows = await tx.employeeTraining.findMany({
        where: {
          kind: 'CERTIFICATION',
          expiresOn: { in: [toDbDate(today), toDbDate(soon)] },
          employee: { status: 'ACTIVE' },
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              membershipId: true,
              assignments: {
                where: {
                  startDate: { lte: toDbDate(today) },
                  OR: [{ endDate: null }, { endDate: { gte: toDbDate(today) } }],
                },
                select: { propertyId: true },
              },
            },
          },
        },
      });
      let sent = 0;
      for (const r of rows) {
        const expiresOn = fromDbDate(r.expiresOn!);
        const when = expiresOn === today ? 'today' : `on ${expiresOn}`;
        if (
          !(await this.inbox.reserveMessage(
            tx,
            `cert-expiry:${r.id}:${expiresOn === today ? 'due' : 'soon'}`,
            'IN_APP',
          ))
        )
          continue;
        const hr = new Set<string>();
        for (const a of r.employee.assignments)
          for (const m of await this.inbox.membersWith(tx, 'employee.manage', a.propertyId))
            hr.add(m);
        await this.inbox.notifyInTx(tx, {
          membershipIds: [...hr],
          kind: 'CERTIFICATIONS_EXPIRING',
          title: `${employeeName(r.employee)}: ${r.title} expires ${when}`,
          link: `/hr/employees/${r.employee.id}`,
        });
        if (r.employee.membershipId) {
          await this.inbox.notifyInTx(tx, {
            membershipIds: [r.employee.membershipId],
            kind: 'CERTIFICATIONS_EXPIRING',
            title: `Your ${r.title} expires ${when}`,
            body: 'Please renew it and give HR the new certificate.',
            link: '/me',
          });
        }
        sent++;
      }
      return sent;
    });
  }

  // ---- Performance reviews -----------------------------------------------------------------

  async reviews(employeeId: string): Promise<PerformanceReview[]> {
    return this.db.run(async (tx) => {
      await this.require(tx, 'employee.performance', employeeId);
      const rows = await tx.employeeReview.findMany({
        where: { employeeId },
        orderBy: [{ reviewDate: 'desc' }, { createdAt: 'desc' }],
      });
      const names = await this.identityNames(
        tx,
        rows.map((r) => r.reviewerId),
      );
      return rows.map((r) => ({
        id: r.id,
        reviewDate: fromDbDate(r.reviewDate),
        periodFrom: r.periodFrom ? fromDbDate(r.periodFrom) : null,
        periodTo: r.periodTo ? fromDbDate(r.periodTo) : null,
        rating: r.rating,
        summary: r.summary,
        strengths: r.strengths,
        improvements: r.improvements,
        goals: r.goals,
        reviewerName: r.reviewerId ? (names.get(r.reviewerId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async addReview(
    employeeId: string,
    input: CreatePerformanceReviewRequest,
  ): Promise<PerformanceReview[]> {
    await this.db.run(async (tx) => {
      const employee = await this.require(tx, 'employee.performance', employeeId);
      // Nobody reviews themselves.
      if (employee.membershipId && employee.membershipId === this.access.membershipId)
        throw Problems.forbidden('You cannot review yourself.');
      const row = await tx.employeeReview.create({
        data: {
          organizationId: this.access.organizationId,
          employeeId,
          reviewDate: toDbDate(input.reviewDate),
          periodFrom: input.periodFrom ? toDbDate(input.periodFrom) : null,
          periodTo: input.periodTo ? toDbDate(input.periodTo) : null,
          rating: input.rating,
          summary: input.summary,
          strengths: input.strengths,
          improvements: input.improvements,
          goals: input.goals,
          reviewerId: this.access.actorId,
        },
      });
      await this.audit.record(tx, {
        action: 'employee.review_recorded',
        entityType: 'employee',
        entityId: employeeId,
        after: { recordId: row.id, reviewDate: input.reviewDate },
      });
    });
    return this.reviews(employeeId);
  }
}
