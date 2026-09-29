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
import type { Transport } from '../http.js';

/** The signed-in staff member: own employee record, shifts, attendance and leave. */
export function meClient({ call, qs }: Transport) {
  return {
    me: {
      notifications: (unread = false) =>
        call<NotificationList>('GET', `/me/notifications${unread ? '?unread=true' : ''}`).then(
          (r) => r.data,
        ),
      readNotification: (notificationId: string) =>
        call<void>('POST', `/me/notifications/${encodeURIComponent(notificationId)}/read`).then(
          (r) => r.data,
        ),
      readAllNotifications: () =>
        call<void>('POST', '/me/notifications/read-all').then((r) => r.data),
      pin: () => call<PinStatus>('GET', '/me/pin').then((r) => r.data),
      setPin: (pin: string, currentPassword: string) =>
        call<PinStatus>('PUT', '/me/pin', { pin, currentPassword }).then((r) => r.data),
      removePin: () => call<PinStatus>('DELETE', '/me/pin').then((r) => r.data),
      employee: () => call<MyEmployee>('GET', '/me/employee').then((r) => r.data),
      shifts: (from: string, to: string) =>
        call<{ items: Shift[] }>('GET', `/me/shifts${qs({ from, to })}`).then((r) => r.data.items),
      attendance: (from: string, to: string) =>
        call<{ items: AttendanceDay[] }>('GET', `/me/attendance${qs({ from, to })}`).then(
          (r) => r.data.items,
        ),
      corrections: () =>
        call<{ items: AttendanceCorrection[] }>('GET', '/me/attendance-corrections').then(
          (r) => r.data.items,
        ),
      requestCorrection: (body: CorrectionRequest) =>
        call<AttendanceCorrection>('POST', '/me/attendance-corrections', body).then((r) => r.data),
      leave: () => call<EmployeeLeave>('GET', '/me/leave').then((r) => r.data),
      requestLeave: (body: CreateLeaveRequest) =>
        call<LeaveRequest>('POST', '/me/leave-requests', body).then((r) => r.data),
      cancelLeave: (id: string) =>
        call<LeaveRequest>('POST', `/me/leave-requests/${encodeURIComponent(id)}/cancel`).then(
          (r) => r.data,
        ),
    },
  };
}
