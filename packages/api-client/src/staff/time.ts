import type {
  AttendanceCorrection,
  AttendanceDay,
  CorrectionRequest,
  CreateLeaveRequest,
  CreateLeaveTypeRequest,
  EmployeeLeave,
  LeaveLedgerPostRequest,
  LeaveRequest,
  LeaveType,
  MyEmployee,
  PhotoRetention,
  Shift,
  UpdateLeaveTypeRequest,
} from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, items, type Transport } from '../http.js';

/**
 * HR time at organization level: leave types and balances, clock photo retention (part of
 * the `hr` group), and the signed-in staff member's own shifts, attendance and leave (`me`).
 */
export function timeClient({ call }: Transport) {
  return {
    hr: {
      photoRetention: () => op.PhotoRetentionController_get<PhotoRetention>(call).then(data),
      setPhotoRetention: (days: number) =>
        op.PhotoRetentionController_set<PhotoRetention>(call, { days }).then(data),
      employeeLeave: (employeeId: string) =>
        op.LeaveController_employeeLeave<EmployeeLeave>(call, { employeeId }).then(data),
      postLeave: (employeeId: string, body: LeaveLedgerPostRequest) =>
        op.LeaveController_postLedger<EmployeeLeave>(call, { employeeId }, body).then(data),
      leaveTypes: () => op.LeaveController_leaveTypes<{ items: LeaveType[] }>(call).then(items),
      createLeaveType: (body: CreateLeaveTypeRequest) =>
        op.LeaveController_createLeaveType<LeaveType>(call, body).then(data),
      updateLeaveType: (leaveTypeId: string, body: UpdateLeaveTypeRequest) =>
        op.LeaveController_updateLeaveType<LeaveType>(call, { leaveTypeId }, body).then(data),
    },
    me: {
      employee: () => op.MeController_employee<MyEmployee>(call).then(data),
      shifts: (from: string, to: string) =>
        op.MeController_shifts<{ items: Shift[] }>(call, { from, to }).then(items),
      attendance: (from: string, to: string) =>
        op.MeController_myAttendance<{ items: AttendanceDay[] }>(call, { from, to }).then(items),
      corrections: () =>
        op.MeController_corrections<{ items: AttendanceCorrection[] }>(call).then(items),
      requestCorrection: (body: CorrectionRequest) =>
        op.MeController_requestCorrection<AttendanceCorrection>(call, body).then(data),
      leave: () => op.MeController_myLeave<EmployeeLeave>(call).then(data),
      requestLeave: (body: CreateLeaveRequest) =>
        op.MeController_requestLeave<LeaveRequest>(call, body).then(data),
      cancelLeave: (leaveRequestId: string) =>
        op.MeController_cancelLeave<LeaveRequest>(call, { leaveRequestId }).then(data),
    },
  };
}
