import type {
  AttendanceCorrection,
  AttendanceDay,
  Birthday,
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
import type { PropertyTransport } from '../../http.js';

/** Attendance, time clock photos, scheduling, staffing, leave and payroll export. */
export function timeClient({ call, qs, baseUrl, p, id }: PropertyTransport) {
  return {
    /** Download URL of the payroll CSV (same-origin; the session cookie authenticates). */
    payrollExportUrl: (from: string, to: string) =>
      `${baseUrl}${p}/payroll-export${qs({ from, to })}`,
    clockPhotos: (from: string, to: string) =>
      call<{ items: ClockPhoto[] }>('GET', `${p}/attendance/photos${qs({ from, to })}`).then(
        (r) => r.data.items,
      ),
    /** Same-origin image URL; each load is audited. */
    clockPhotoUrl: (punchId: string) => `${baseUrl}${p}/attendance/photos/${id(punchId)}`,
    /** Web punch: the selfie taken now is the body (ADR-0022). */
    punch: (type: PunchType, selfie: Blob) =>
      call<Punch>('POST', `${p}/attendance/punches${qs({ type })}`, selfie).then((r) => r.data),
    attendance: (from: string, to: string) =>
      call<{ items: AttendanceDay[] }>('GET', `${p}/attendance${qs({ from, to })}`).then(
        (r) => r.data.items,
      ),
    attendanceCorrections: (status?: AttendanceCorrection['status']) =>
      call<{ items: AttendanceCorrection[] }>(
        'GET',
        `${p}/attendance/corrections${qs({ status })}`,
      ).then((r) => r.data.items),
    decideCorrection: (id: string, version: number, body: DecisionRequest) =>
      call<AttendanceCorrection>(
        'POST',
        `${p}/attendance/corrections/${encodeURIComponent(id)}/decision`,
        body,
        { 'if-match': `W/"${version}"` },
      ).then((r) => r.data),
    shiftTemplates: () =>
      call<{ items: ShiftTemplate[] }>('GET', `${p}/shift-templates`).then((r) => r.data.items),
    schedule: (from: string, to: string) =>
      call<Schedule>('GET', `${p}/schedule${qs({ from, to })}`).then((r) => r.data),
    createShift: (body: CreateShiftRequest) =>
      call<ShiftWithWarnings>('POST', `${p}/shifts`, body).then((r) => r.data),
    updateShift: (id: string, version: number, body: UpdateShiftRequest) =>
      call<ShiftWithWarnings>('PATCH', `${p}/shifts/${encodeURIComponent(id)}`, body, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
    cancelShift: (id: string, version: number) =>
      call<Shift>('POST', `${p}/shifts/${encodeURIComponent(id)}/cancel`, undefined, {
        'if-match': `W/"${version}"`,
      }).then((r) => r.data),
    publishSchedule: (from: string, to: string) =>
      call<PublishResult>('POST', `${p}/schedule/publish`, { from, to }).then((r) => r.data),
    createRecurringShifts: (body: CreateRecurringShiftsInput) =>
      call<RecurringShiftsResult>('POST', `${p}/shifts/recurring`, body).then((r) => r.data),
    cancelShiftSeries: (seriesId: string, body: { fromDate?: string; employeeId?: string }) =>
      call<{ cancelled: number }>('POST', `${p}/shift-series/${id(seriesId)}/cancel`, body).then(
        (r) => r.data,
      ),
    staffingRequirements: () =>
      call<{ items: StaffingRequirement[] }>('GET', `${p}/staffing-requirements`).then(
        (r) => r.data.items,
      ),
    createStaffingRequirement: (body: CreateStaffingRequirementRequest) =>
      call<{ items: StaffingRequirement[] }>('POST', `${p}/staffing-requirements`, body).then(
        (r) => r.data.items,
      ),
    archiveStaffingRequirement: (requirementId: string) =>
      call<void>('POST', `${p}/staffing-requirements/${id(requirementId)}/archive`).then(
        (r) => r.data,
      ),
    coverage: (from: string, to: string) =>
      call<{ items: CoverageGap[] }>('GET', `${p}/schedule/coverage${qs({ from, to })}`).then(
        (r) => r.data.items,
      ),
    leaveRequests: (status?: LeaveRequest['status']) =>
      call<{ items: LeaveRequest[] }>('GET', `${p}/leave-requests${qs({ status })}`).then(
        (r) => r.data.items,
      ),
    decideLeave: (id: string, version: number, body: DecisionRequest) =>
      call<LeaveDecisionResult>(
        'POST',
        `${p}/leave-requests/${encodeURIComponent(id)}/decision`,
        body,
        { 'if-match': `W/"${version}"` },
      ).then((r) => r.data),
    birthdays: () => call<{ items: Birthday[] }>('GET', `${p}/birthdays`).then((r) => r.data.items),
  };
}
