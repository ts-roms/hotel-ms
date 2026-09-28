import { Injectable } from '@nestjs/common';
import type { PermissionCode, SearchResult } from '@hotel/contracts';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/request-context.js';
import { TenantDb } from '../../infrastructure/database.js';
import { employeeName, HrAccess } from '../hr/hr-access.js';

const PER_KIND = 5;
type Item = SearchResult['items'][number];

/**
 * Global search (spec §73, ADR-0025): one box for guests, reservations, rooms, employees,
 * orders, invoices, service requests and maintenance. Each kind is searched only where the
 * caller holds its read permission (property-scoped grants narrow the properties), so
 * search never reveals more than the matching list screens would.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: HrAccess,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  /** Undefined: no access at all; otherwise a propertyId filter (empty object = all). */
  private scope(permission: PermissionCode): { propertyId?: { in: string[] } } | undefined {
    const scope = this.cls.get('grants')!.propertyScope(permission);
    if (scope.kind === 'all') return {};
    return scope.propertyIds.length ? { propertyId: { in: scope.propertyIds } } : undefined;
  }

  async search(q: string): Promise<SearchResult> {
    const contains = { contains: q, mode: 'insensitive' as const };
    return this.db.run(async (tx) => {
      const properties = new Map(
        (await tx.property.findMany({ select: { id: true, name: true } })).map((p) => [
          p.id,
          p.name,
        ]),
      );
      const name = (id: string) => properties.get(id) ?? null;
      const items: Item[] = [];

      const reservations = this.scope('reservation.read');
      if (reservations) {
        const rows = await tx.reservation.findMany({
          where: { ...reservations, confirmationNo: contains },
          include: { booker: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND,
        });
        for (const r of rows)
          items.push({
            kind: 'reservation',
            id: r.id,
            title: r.confirmationNo,
            subtitle: `${r.booker.firstName} ${r.booker.lastName} · ${r.status.toLowerCase()}`,
            propertyName: name(r.propertyId),
            link: `/p/${r.propertyId}/reservations/${r.id}`,
          });
      }

      const guests = this.scope('guest.read');
      if (guests && reservations) {
        // Guests are organization records; show them through a reservation the caller can open.
        const rows = await tx.guest.findMany({
          where: {
            archivedAt: null,
            OR: [
              { firstName: contains },
              { lastName: contains },
              { email: contains },
              { phone: { contains: q } },
            ],
            bookings: { some: reservations },
          },
          include: {
            bookings: {
              where: reservations,
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { id: true, propertyId: true, confirmationNo: true },
            },
          },
          take: PER_KIND,
        });
        for (const g of rows) {
          const latest = g.bookings[0];
          if (!latest) continue;
          items.push({
            kind: 'guest',
            id: g.id,
            title: `${g.firstName} ${g.lastName}`,
            subtitle: [g.email, `latest ${latest.confirmationNo}`].filter(Boolean).join(' · '),
            propertyName: name(latest.propertyId),
            link: `/p/${latest.propertyId}/reservations/${latest.id}`,
          });
        }
      }

      const rooms = this.scope('room.read');
      if (rooms && /^[\w-]{1,10}$/.test(q)) {
        const rows = await tx.room.findMany({
          where: { ...rooms, archivedAt: null, number: { startsWith: q, mode: 'insensitive' } },
          include: { roomType: { select: { name: true } } },
          take: PER_KIND,
        });
        for (const r of rows)
          items.push({
            kind: 'room',
            id: r.id,
            title: `Room ${r.number}`,
            subtitle: r.roomType.name,
            propertyName: name(r.propertyId),
            link: `/p/${r.propertyId}/rooms`,
          });
      }

      if (this.cls.get('grants')!.hasAnywhere('employee.read')) {
        const rows = await tx.employee.findMany({
          where: {
            ...this.access.employeeWhere('employee.read'),
            OR: [
              { employeeNo: contains },
              { firstName: contains },
              { lastName: contains },
              { preferredName: contains },
            ],
          },
          take: PER_KIND,
        });
        for (const e of rows)
          items.push({
            kind: 'employee',
            id: e.id,
            title: employeeName(e),
            subtitle: `${e.employeeNo} · ${e.status.toLowerCase()}`,
            propertyName: null,
            link: `/hr/employees/${e.id}`,
          });
      }

      const orders = this.scope('fnb.order.read');
      if (orders) {
        const rows = await tx.order.findMany({
          where: { ...orders, orderNo: contains },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND,
        });
        for (const o of rows)
          items.push({
            kind: 'order',
            id: o.id,
            title: o.orderNo,
            subtitle: o.status.toLowerCase().replaceAll('_', ' '),
            propertyName: name(o.propertyId),
            link: `/p/${o.propertyId}/orders`,
          });
      }

      const documents = this.scope('folio.read');
      if (documents) {
        const rows = await tx.folioDocument.findMany({
          where: { ...documents, documentNo: contains },
          orderBy: { issuedAt: 'desc' },
          take: PER_KIND,
        });
        for (const d of rows)
          items.push({
            kind: 'invoice',
            id: d.id,
            title: d.documentNo,
            subtitle: d.type.toLowerCase().replaceAll('_', ' '),
            propertyName: name(d.propertyId),
            link: `/p/${d.propertyId}/documents/${d.id}`,
          });
      }

      const requests = this.scope('guest_service.read');
      if (requests) {
        const rows = await tx.serviceRequest.findMany({
          where: { ...requests, OR: [{ requestNo: contains }, { description: contains }] },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND,
        });
        for (const r of rows)
          items.push({
            kind: 'service_request',
            id: r.id,
            title: r.requestNo,
            subtitle: `${r.category.toLowerCase().replaceAll('_', ' ')} · ${r.status.toLowerCase()}`,
            propertyName: name(r.propertyId),
            link: `/p/${r.propertyId}/service-requests`,
          });
      }

      const maintenance = this.scope('maintenance.read');
      if (maintenance) {
        const rows = await tx.maintenanceRequest.findMany({
          where: { ...maintenance, OR: [{ requestNo: contains }, { title: contains }] },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND,
        });
        for (const m of rows)
          items.push({
            kind: 'maintenance',
            id: m.id,
            title: `${m.requestNo} ${m.title}`,
            subtitle: m.status.toLowerCase().replaceAll('_', ' '),
            propertyName: name(m.propertyId),
            link: `/p/${m.propertyId}/maintenance`,
          });
      }
      return { items };
    });
  }
}
