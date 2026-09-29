import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  fnbReportSchema,
  guestServiceReportSchema,
  hrReportSchema,
  occupancyReportSchema,
  propertyDashboardSchema,
  type ReportRangeQuery,
  reportRangeQuerySchema,
} from '@hotel/contracts';
import type { FastifyReply } from 'fastify';
import { csvField } from '../../common/csv.js';
import { toDecimalString } from '../../common/money.js';
import { RequirePermission } from '../../common/route-metadata.js';
import { ZodQuery, ZodResponse } from '../../common/zod.js';
import { ManagementService } from './management.service.js';

const toCsv = (header: string[], rows: (string | number | null)[][]) =>
  [header, ...rows].map((r) => r.map((v) => csvField(v)).join(',')).join('\r\n') + '\r\n';

function sendCsv(reply: FastifyReply, name: string, query: ReportRangeQuery, csv: string) {
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header(
    'content-disposition',
    `attachment; filename="${name}-${query.from}-${query.to}.csv"`,
  );
  reply.header('cache-control', 'no-store');
  return csv;
}

/** Property dashboard and operational reports (ADR-0025). */
@ApiTags('management')
@Controller('properties/:propertyId')
export class PropertyReportsController {
  constructor(private readonly management: ManagementService) {}

  @Get('dashboard')
  @RequirePermission('property.read')
  @ZodResponse(200, propertyDashboardSchema)
  dashboard(@Param('propertyId') propertyId: string) {
    return this.management.propertyDashboard(propertyId);
  }

  @Get('reports/occupancy')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, occupancyReportSchema)
  occupancy(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
  ) {
    return this.management.occupancy(propertyId, query.from, query.to);
  }

  @Get('reports/occupancy/export')
  @RequirePermission('finance.report.read')
  @ApiProduces('text/csv')
  async occupancyCsv(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const r = await this.management.occupancy(propertyId, query.from, query.to);
    return sendCsv(
      reply,
      'occupancy',
      query,
      toCsv(
        [
          'date',
          'rooms_available',
          'rooms_sold',
          'occupancy_pct',
          `room_revenue_${r.currency}`,
          'adr',
          'revpar',
          'arrivals',
          'departures',
          'no_shows',
        ],
        r.days.map((d) => [
          d.date,
          d.roomsAvailable,
          d.roomsSold,
          d.occupancyPct,
          toDecimalString(d.roomRevenueMinor, r.currency),
          toDecimalString(d.adrMinor, r.currency),
          toDecimalString(d.revparMinor, r.currency),
          d.arrivals,
          d.departures,
          d.noShows,
        ]),
      ),
    );
  }

  @Get('reports/hr')
  @RequirePermission('attendance.read')
  @ZodResponse(200, hrReportSchema)
  hr(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
  ) {
    return this.management.hr(propertyId, query.from, query.to);
  }

  @Get('reports/hr/export')
  @RequirePermission('attendance.read')
  @ApiProduces('text/csv')
  async hrCsv(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const r = await this.management.hr(propertyId, query.from, query.to);
    const a = r.attendance;
    return sendCsv(
      reply,
      'hr',
      query,
      toCsv(
        ['section', 'item', 'value'],
        [
          ['headcount', 'total', r.headcount],
          ...r.byDepartment.map((d) => ['headcount', d.department, d.headcount]),
          ['attendance', 'present_days', a.present],
          ['attendance', 'late_days', a.late],
          ['attendance', 'absent_days', a.absent],
          ['attendance', 'worked_minutes', a.workedMinutes],
          ['attendance', 'late_minutes', a.lateMinutes],
          ['attendance', 'overtime_minutes', a.overtimeMinutes],
          ['attendance', 'undertime_minutes', a.undertimeMinutes],
          ...r.leave.map((l) => ['leave_days', l.leaveType, l.days]),
        ],
      ),
    );
  }

  @Get('reports/fnb')
  @RequirePermission('finance.report.read')
  @ZodResponse(200, fnbReportSchema)
  fnb(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
  ) {
    return this.management.fnb(propertyId, query.from, query.to);
  }

  @Get('reports/fnb/export')
  @RequirePermission('finance.report.read')
  @ApiProduces('text/csv')
  async fnbCsv(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const r = await this.management.fnb(propertyId, query.from, query.to);
    return sendCsv(
      reply,
      'fnb',
      query,
      toCsv(
        ['item', 'quantity', `sales_${r.currency}`],
        r.topItems.map((i) => [i.name, i.quantity, toDecimalString(i.salesMinor, r.currency)]),
      ),
    );
  }

  @Get('reports/guest-services')
  @RequirePermission('guest_service.read')
  @ZodResponse(200, guestServiceReportSchema)
  guestServices(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
  ) {
    return this.management.guestServices(propertyId, query.from, query.to);
  }

  @Get('reports/guest-services/export')
  @RequirePermission('guest_service.read')
  @ApiProduces('text/csv')
  async guestServicesCsv(
    @Param('propertyId') propertyId: string,
    @ZodQuery(reportRangeQuerySchema) query: ReportRangeQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const r = await this.management.guestServices(propertyId, query.from, query.to);
    return sendCsv(
      reply,
      'guest-services',
      query,
      toCsv(
        ['category', 'requests', 'average_completion_minutes'],
        r.byCategory.map((c) => [c.category, c.requests, c.averageCompletionMinutes]),
      ),
    );
  }
}
