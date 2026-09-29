import type {
  AttendanceCorrection,
  AttendanceDay,
  CorrectionRequest,
  CreateLeaveRequest,
  EmployeeLeave,
  LeaveRequest,
  MyEmployee,
  NotificationList,
  PinStatus,
  Shift,
} from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, items, type Transport } from '../http.js';

/** The signed-in staff member: own employee record, shifts, attendance and leave. */
export function meClient({ call }: Transport) {
  return {
    me: {
      notifications: (unread = false) =>
        op
          .NotificationsController_list<NotificationList>(call, unread ? { unread: 'true' } : {})
          .then(data),
      readNotification: (notificationId: string) =>
        op.NotificationsController_read(call, { notificationId }).then(data),
      readAllNotifications: () => op.NotificationsController_readAll(call).then(data),
      pin: () => op.PinController_status<PinStatus>(call).then(data),
      setPin: (pin: string, currentPassword: string) =>
        op.PinController_set<PinStatus>(call, { pin, currentPassword }).then(data),
      removePin: () => op.PinController_remove<PinStatus>(call).then(data),
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
      cancelLeave: (id: string) =>
        op.MeController_cancelLeave<LeaveRequest>(call, { leaveRequestId: id }).then(data),
    },
  };
}
