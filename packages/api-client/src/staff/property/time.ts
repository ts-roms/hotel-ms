import type {
  AttendanceCorrection,
  AttendanceDay,
  CancelSeriesRequest,
  ClockPhoto,
  CoverageGap,
  CreateRecurringShiftsInput,
  CreateShiftRequest,
  CreateStaffingRequirementRequest,
  DecisionRequest,
  LeaveDecisionResult,
  LeaveRequest,
  PublishResult,
  Punch,
  PunchType,
  RecurringShiftsResult,
  Schedule,
  Shift,
  ShiftTemplate,
  ShiftWithWarnings,
  StaffingRequirement,
  UpdateShiftRequest,
} from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, items, type PropertyTransport } from '../../http.js';

/** HR time: attendance, time clock photos, scheduling, staffing, leave and payroll export. */
export function timeClient({ call, baseUrl, propertyId }: PropertyTransport) {
  return {
    /** Download URL of the payroll CSV (same-origin; the session cookie authenticates). */
    payrollExportUrl: (from: string, to: string) =>
      `${baseUrl}${op.paths.PropertyHrController_payrollExport({ propertyId }, { from, to })}`,
    clockPhotos: (from: string, to: string) =>
      op
        .ClockPhotosController_list<{ items: ClockPhoto[] }>(call, { propertyId }, { from, to })
        .then(items),
    /** Same-origin image URL; each load is audited. */
    clockPhotoUrl: (punchId: string) =>
      `${baseUrl}${op.paths.ClockPhotosController_photo({ propertyId, punchId })}`,
    /** Web punch: the selfie taken now is the body (ADR-0022). */
    punch: (type: PunchType, selfie: Blob) =>
      op.PropertyHrController_punch<Punch>(call, { propertyId }, { type }, selfie).then(data),
    attendance: (from: string, to: string) =>
      op
        .PropertyHrController_attendanceDays<{ items: AttendanceDay[] }>(
          call,
          { propertyId },
          { from, to },
        )
        .then(items),
    attendanceCorrections: (status?: AttendanceCorrection['status']) =>
      op
        .PropertyHrController_corrections<{ items: AttendanceCorrection[] }>(
          call,
          { propertyId },
          { status },
        )
        .then(items),
    decideCorrection: (correctionId: string, version: number, body: DecisionRequest) =>
      op
        .PropertyHrController_decideCorrection<AttendanceCorrection>(
          call,
          { propertyId, correctionId },
          body,
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
    shiftTemplates: () =>
      op
        .PropertyHrController_templates<{ items: ShiftTemplate[] }>(call, { propertyId })
        .then(items),
    schedule: (from: string, to: string) =>
      op.PropertyHrController_scheduleView<Schedule>(call, { propertyId }, { from, to }).then(data),
    createShift: (body: CreateShiftRequest) =>
      op.PropertyHrController_createShift<ShiftWithWarnings>(call, { propertyId }, body).then(data),
    updateShift: (shiftId: string, version: number, body: UpdateShiftRequest) =>
      op
        .PropertyHrController_updateShift<ShiftWithWarnings>(call, { propertyId, shiftId }, body, {
          ifMatch: `W/"${version}"`,
        })
        .then(data),
    cancelShift: (shiftId: string, version: number) =>
      op
        .PropertyHrController_cancelShift<Shift>(
          call,
          { propertyId, shiftId },
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
    publishSchedule: (from: string, to: string) =>
      op.PropertyHrController_publish<PublishResult>(call, { propertyId }, { from, to }).then(data),
    createRecurringShifts: (body: CreateRecurringShiftsInput) =>
      op.StaffingController_recurring<RecurringShiftsResult>(call, { propertyId }, body).then(data),
    cancelShiftSeries: (seriesId: string, body: CancelSeriesRequest) =>
      op
        .StaffingController_cancelSeries<{ cancelled: number }>(
          call,
          { propertyId, seriesId },
          body,
        )
        .then(data),
    staffingRequirements: () =>
      op
        .StaffingController_requirements<{ items: StaffingRequirement[] }>(call, { propertyId })
        .then(items),
    createStaffingRequirement: (body: CreateStaffingRequirementRequest) =>
      op
        .StaffingController_createRequirement<{ items: StaffingRequirement[] }>(
          call,
          { propertyId },
          body,
        )
        .then(items),
    archiveStaffingRequirement: (requirementId: string) =>
      op.StaffingController_archiveRequirement(call, { propertyId, requirementId }).then(data),
    coverage: (from: string, to: string) =>
      op
        .StaffingController_coverage<{ items: CoverageGap[] }>(call, { propertyId }, { from, to })
        .then(items),
    leaveRequests: (status?: LeaveRequest['status']) =>
      op
        .PropertyHrController_leaveRequests<{ items: LeaveRequest[] }>(
          call,
          { propertyId },
          { status },
        )
        .then(items),
    decideLeave: (leaveRequestId: string, version: number, body: DecisionRequest) =>
      op
        .PropertyHrController_decideLeave<LeaveDecisionResult>(
          call,
          { propertyId, leaveRequestId },
          body,
          { ifMatch: `W/"${version}"` },
        )
        .then(data),
  };
}
