/**
 * Domain event envelope and catalog (ADR-0005). Events are written to the transactional
 * outbox in the same database transaction as the change that caused them.
 */
export interface DomainEventEnvelope<TType extends string = string, TPayload = unknown> {
  eventId: string;
  type: TType;
  version: number;
  occurredAt: string;
  organizationId: string;
  propertyId: string | null;
  actor: { type: string; id: string | null };
  correlationId: string | null;
  payload: TPayload;
}

export interface DomainEventPayloads {
  PropertyCreated: { propertyId: string; code: string; name: string };
  PropertyUpdated: { propertyId: string; changedFields: string[] };
  MemberInvited: { membershipId: string; identityId: string };
  MemberJoined: { membershipId: string; identityId: string };
  MemberStatusChanged: { membershipId: string; status: string };
  RoleAssigned: {
    membershipId: string;
    assignmentId: string;
    roleId: string;
    propertyId: string | null;
  };
  RoleUnassigned: {
    membershipId: string;
    assignmentId: string;
    roleId: string;
    propertyId: string | null;
  };
  RoleCreated: { roleId: string; key: string };
  RoleUpdated: { roleId: string; changedFields: string[] };
  RoleDeleted: { roleId: string; key: string };
  ReservationCreated: { reservationId: string; confirmationNo: string; roomLineIds: string[] };
  ReservationModified: {
    reservationId: string;
    reservationRoomId: string;
    changedFields: string[];
  };
  ReservationCancelled: { reservationId: string; reservationRoomIds: string[]; reason: string };
  RoomAssigned: { reservationRoomId: string; roomId: string };
  RoomUnassigned: { reservationRoomId: string; roomId: string };
  RoomBlocked: { roomId: string; blockId: string; startDate: string; endDate: string };
  RoomUnblocked: { roomId: string; blockId: string };
  RoomStatusChanged: {
    roomId: string;
    dimension: 'HOUSEKEEPING' | 'SERVICE';
    from: string;
    to: string;
  };
  GuestCheckedIn: { reservationRoomId: string; stayId: string; roomId: string; folioId: string };
  GuestCheckedOut: { reservationRoomId: string; stayId: string; roomId: string; folioId: string };
  FolioLinePosted: { folioId: string; lineId: string; type: string; amountMinor: number };
  PaymentRecorded: { folioId: string; paymentId: string; method: string; amountMinor: number };
  GuestPortalLinkSent: { reservationId: string };
  PaymentSucceeded: {
    paymentIntentId: string;
    paymentId: string | null;
    folioId: string;
    amountMinor: number;
  };
  PaymentFailed: { paymentIntentId: string; folioId: string; reason: string };
  RefundIssued: { refundId: string; paymentId: string; amountMinor: number; status: string };
  CashierShiftClosed: { shiftId: string; varianceMinor: number };
  DocumentIssued: { documentId: string; type: string; documentNo: string };
  OrderPlaced: { orderId: string; outletId: string; source: 'GUEST' | 'STAFF' };
  OrderStatusChanged: { orderId: string; outletId: string; from: string; to: string };
  OrderCharged: { orderId: string; folioId: string; lineId: string; totalMinor: number };
  EmployeeHired: { employeeId: string };
  EmployeeTerminated: { employeeId: string; terminatedOn: string };
  EmployeeClockedIn: { employeeId: string; punchId: string };
  EmployeeClockedOut: { employeeId: string; punchId: string };
  SchedulePublished: { from: string; to: string; shiftIds: string[] };
  ShiftChanged: { shiftId: string; employeeId: string; status: string };
  LeaveRequested: { leaveRequestId: string; employeeId: string };
  LeaveApproved: { leaveRequestId: string; employeeId: string; conflictingShiftIds: string[] };
  LeaveRejected: { leaveRequestId: string; employeeId: string };
  LeaveCancelled: { leaveRequestId: string; employeeId: string };
  GuestPreCheckedIn: { reservationRoomId: string };
  ServiceRequestCreated: {
    serviceRequestId: string;
    department: string;
    source: 'GUEST' | 'STAFF';
  };
  ServiceRequestUpdated: { serviceRequestId: string; status: string };
  BusinessDateClosed: { businessDate: string; nextBusinessDate: string };
}

export type DomainEventType = keyof DomainEventPayloads;
