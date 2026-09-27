import { z } from 'zod';
import { localDateSchema, localTimeSchema } from './common.js';

/**
 * HR contracts (blueprint §13): people, employment assignments, scheduling, attendance,
 * leave and birthdays. Leave amounts travel as days in steps of 0.5; the ledger stores
 * half-days as integers so balances are exact.
 */

const code = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{1,20}$/, 'Use 1–20 capital letters, digits, "-" or "_"');
const name = z.string().trim().min(1).max(100);
const days = z
  .number()
  .refine((v) => Number.isInteger(v * 2), 'Use whole or half days')
  .refine((v) => v !== 0 && Math.abs(v) <= 366, 'Between -366 and 366, not 0');

// ---- Departments and positions ---------------------------------------------------------------

export const positionSchema = z.object({
  id: z.uuid(),
  departmentId: z.uuid(),
  code: z.string(),
  name: z.string(),
  archived: z.boolean(),
});
export type Position = z.infer<typeof positionSchema>;

export const departmentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  archived: z.boolean(),
  positions: z.array(positionSchema),
});
export type Department = z.infer<typeof departmentSchema>;

export const createDepartmentRequestSchema = z.strictObject({ code, name });
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequestSchema>;

export const updateDepartmentRequestSchema = z
  .strictObject({ name, archived: z.boolean() })
  .partial();
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentRequestSchema>;

export const createPositionRequestSchema = z.strictObject({ departmentId: z.uuid(), code, name });
export type CreatePositionRequest = z.infer<typeof createPositionRequestSchema>;

// ---- Employees -----------------------------------------------------------------------------

export const EMPLOYEE_STATUSES = ['ACTIVE', 'TERMINATED'] as const;
export const BIRTHDAY_VISIBILITIES = ['DAY_MONTH', 'HIDDEN'] as const;

export const assignmentSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  propertyName: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  positionId: z.uuid().nullable(),
  positionName: z.string().nullable(),
  startDate: localDateSchema,
  /** Last working day, inclusive; null = open-ended. */
  endDate: localDateSchema.nullable(),
  isPrimary: z.boolean(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const employeeSummarySchema = z.object({
  id: z.uuid(),
  employeeNo: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  status: z.enum(EMPLOYEE_STATUSES),
  /** Active assignments today. */
  assignments: z.array(assignmentSchema),
});
export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;

/** Present only for callers with employee.personal.read covering the employee. */
export const employeePersonalSchema = z.object({
  birthDate: localDateSchema.nullable(),
  personalEmail: z.string().nullable(),
  personalPhone: z.string().nullable(),
});
export type EmployeePersonal = z.infer<typeof employeePersonalSchema>;

export const employeeSchema = employeeSummarySchema.extend({
  workEmail: z.string().nullable(),
  workPhone: z.string().nullable(),
  hireDate: localDateSchema,
  terminatedOn: localDateSchema.nullable(),
  birthdayVisibility: z.enum(BIRTHDAY_VISIBILITIES),
  membershipId: z.uuid().nullable(),
  /** All assignments, past and future included. */
  assignmentHistory: z.array(assignmentSchema),
  personal: employeePersonalSchema.nullable(),
  version: z.number().int(),
});
export type Employee = z.infer<typeof employeeSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const newAssignmentSchema = z.strictObject({
  propertyId: z.uuid(),
  departmentId: z.uuid(),
  positionId: z.uuid().nullable().default(null),
  startDate: localDateSchema,
  endDate: localDateSchema.nullable().default(null),
  isPrimary: z.boolean().default(false),
});
export type NewAssignment = z.infer<typeof newAssignmentSchema>;

export const createEmployeeRequestSchema = z.strictObject({
  employeeNo: z.string().trim().min(1).max(30),
  firstName: name,
  lastName: name,
  preferredName: optionalText(100).default(null),
  workEmail: z.email().max(254).nullable().default(null),
  workPhone: optionalText(40).default(null),
  hireDate: localDateSchema,
  birthdayVisibility: z.enum(BIRTHDAY_VISIBILITIES).default('HIDDEN'),
  personal: z
    .strictObject({
      birthDate: localDateSchema.nullable().default(null),
      personalEmail: z.email().max(254).nullable().default(null),
      personalPhone: optionalText(40).default(null),
    })
    .optional(),
  /** Every employee starts with an assignment, so someone in scope can see them. */
  assignment: newAssignmentSchema,
});
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;

export const updateEmployeeRequestSchema = z
  .strictObject({
    firstName: name,
    lastName: name,
    preferredName: optionalText(100),
    workEmail: z.email().max(254).nullable(),
    workPhone: optionalText(40),
    birthdayVisibility: z.enum(BIRTHDAY_VISIBILITIES),
    personal: z
      .strictObject({
        birthDate: localDateSchema.nullable(),
        personalEmail: z.email().max(254).nullable(),
        personalPhone: optionalText(40),
      })
      .partial(),
  })
  .partial();
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeRequestSchema>;

export const terminateEmployeeRequestSchema = z.strictObject({ terminatedOn: localDateSchema });
export type TerminateEmployeeRequest = z.infer<typeof terminateEmployeeRequestSchema>;

export const endAssignmentRequestSchema = z.strictObject({ endDate: localDateSchema });
export type EndAssignmentRequest = z.infer<typeof endAssignmentRequestSchema>;

export const linkMembershipRequestSchema = z.strictObject({ membershipId: z.uuid().nullable() });
export type LinkMembershipRequest = z.infer<typeof linkMembershipRequestSchema>;

export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  propertyId: z.uuid().optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

// ---- Scheduling ------------------------------------------------------------------------------

export const SHIFT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;

export const shiftTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  departmentId: z.uuid().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  breakMinutes: z.number().int(),
});
export type ShiftTemplate = z.infer<typeof shiftTemplateSchema>;

export const createShiftTemplateRequestSchema = z.strictObject({
  name,
  departmentId: z.uuid().nullable().default(null),
  startTime: localTimeSchema,
  /** Earlier than startTime = ends the next day. */
  endTime: localTimeSchema,
  breakMinutes: z.number().int().min(0).max(240).default(60),
});
export type CreateShiftTemplateRequest = z.infer<typeof createShiftTemplateRequestSchema>;

export const shiftSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  /** Property-local date the shift starts on. */
  date: localDateSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** Property-local wall-clock times, "HH:mm". */
  startTime: z.string(),
  endTime: z.string(),
  breakMinutes: z.number().int(),
  status: z.enum(SHIFT_STATUSES),
  notes: z.string(),
  version: z.number().int(),
});
export type Shift = z.infer<typeof shiftSchema>;

export const shiftWarningSchema = z.object({
  code: z.enum(['ON_LEAVE', 'SHORT_REST']),
  message: z.string(),
});
export type ShiftWarning = z.infer<typeof shiftWarningSchema>;

export const shiftWithWarningsSchema = shiftSchema.extend({
  warnings: z.array(shiftWarningSchema),
});
export type ShiftWithWarnings = z.infer<typeof shiftWithWarningsSchema>;

export const createShiftRequestSchema = z
  .strictObject({
    employeeId: z.uuid(),
    date: localDateSchema,
    templateId: z.uuid().nullable().default(null),
    startTime: localTimeSchema.optional(),
    endTime: localTimeSchema.optional(),
    breakMinutes: z.number().int().min(0).max(240).optional(),
    /** Defaults to the employee's department at this property. */
    departmentId: z.uuid().nullable().default(null),
    notes: z.string().trim().max(500).default(''),
  })
  .refine((v) => v.templateId !== null || (v.startTime && v.endTime), {
    message: 'Give a template or both start and end times',
    path: ['startTime'],
  });
export type CreateShiftRequest = z.infer<typeof createShiftRequestSchema>;

export const updateShiftRequestSchema = z
  .strictObject({
    startTime: localTimeSchema,
    endTime: localTimeSchema,
    breakMinutes: z.number().int().min(0).max(240),
    notes: z.string().trim().max(500),
  })
  .partial();
export type UpdateShiftRequest = z.infer<typeof updateShiftRequestSchema>;

export const dateRangeQuerySchema = z
  .object({ from: localDateSchema, to: localDateSchema })
  .refine((v) => v.from <= v.to, { message: 'from must not be after to', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, {
    message: 'At most 62 days',
    path: ['to'],
  });
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

export const publishScheduleRequestSchema = z.strictObject({
  from: localDateSchema,
  to: localDateSchema,
});
export type PublishScheduleRequest = z.infer<typeof publishScheduleRequestSchema>;

export const unavailabilitySchema = z.object({
  employeeId: z.uuid(),
  from: localDateSchema,
  to: localDateSchema,
  /** "Unavailable" unless the caller may read leave details (blueprint §13.5). */
  label: z.string(),
});

export const scheduleSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  employees: z.array(z.object({ id: z.uuid(), name: z.string(), departmentName: z.string() })),
  shifts: z.array(shiftSchema),
  unavailability: z.array(unavailabilitySchema),
});
export type Schedule = z.infer<typeof scheduleSchema>;

// ---- Attendance ------------------------------------------------------------------------------

export const PUNCH_TYPES = ['IN', 'OUT', 'BREAK_START', 'BREAK_END'] as const;
export type PunchType = (typeof PUNCH_TYPES)[number];

export const punchSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  type: z.enum(PUNCH_TYPES),
  at: z.iso.datetime(),
  source: z.enum(['WEB', 'KIOSK', 'CORRECTION']),
});
export type Punch = z.infer<typeof punchSchema>;

export const punchRequestSchema = z.strictObject({ type: z.enum(PUNCH_TYPES) });
export type PunchRequest = z.infer<typeof punchRequestSchema>;

export const ATTENDANCE_DAY_STATUSES = [
  'PRESENT',
  'ABSENT',
  'INCOMPLETE',
  'ON_LEAVE',
  'SCHEDULED',
] as const;

export const attendanceDaySchema = z.object({
  employeeId: z.uuid(),
  employeeName: z.string(),
  date: localDateSchema,
  status: z.enum(ATTENDANCE_DAY_STATUSES),
  shift: z
    .object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), breakMinutes: z.number() })
    .nullable(),
  firstIn: z.iso.datetime().nullable(),
  lastOut: z.iso.datetime().nullable(),
  workedMinutes: z.number().int(),
  breakMinutes: z.number().int(),
  lateMinutes: z.number().int(),
  undertimeMinutes: z.number().int(),
  overtimeMinutes: z.number().int(),
});
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

export const attendanceCorrectionSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  type: z.enum(PUNCH_TYPES),
  at: z.iso.datetime(),
  reason: z.string(),
  status: z.enum(APPROVAL_STATUSES),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type AttendanceCorrection = z.infer<typeof attendanceCorrectionSchema>;

export const correctionRequestSchema = z.strictObject({
  propertyId: z.uuid(),
  type: z.enum(PUNCH_TYPES),
  at: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(3).max(500),
});
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;

export const decisionRequestSchema = z.strictObject({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).default(''),
});
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;

// ---- Leave ---------------------------------------------------------------------------------

export const leaveTypeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  paid: z.boolean(),
  allowNegative: z.boolean(),
  minNoticeDays: z.number().int(),
  archived: z.boolean(),
});
export type LeaveType = z.infer<typeof leaveTypeSchema>;

export const createLeaveTypeRequestSchema = z.strictObject({
  code,
  name,
  paid: z.boolean().default(true),
  allowNegative: z.boolean().default(false),
  minNoticeDays: z.number().int().min(0).max(365).default(0),
});
export type CreateLeaveTypeRequest = z.infer<typeof createLeaveTypeRequestSchema>;

export const updateLeaveTypeRequestSchema = z
  .strictObject({
    name,
    paid: z.boolean(),
    allowNegative: z.boolean(),
    minNoticeDays: z.number().int().min(0).max(365),
    archived: z.boolean(),
  })
  .partial();
export type UpdateLeaveTypeRequest = z.infer<typeof updateLeaveTypeRequestSchema>;

export const leaveBalanceSchema = z.object({
  leaveTypeId: z.uuid(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  days: z.number(),
});
export type LeaveBalance = z.infer<typeof leaveBalanceSchema>;

export const LEAVE_LEDGER_KINDS = ['ACCRUAL', 'USAGE', 'ADJUSTMENT', 'REVERSAL'] as const;

export const leaveLedgerEntrySchema = z.object({
  id: z.uuid(),
  leaveTypeId: z.uuid(),
  leaveTypeCode: z.string(),
  kind: z.enum(LEAVE_LEDGER_KINDS),
  days: z.number(),
  effectiveDate: localDateSchema,
  note: z.string(),
  leaveRequestId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type LeaveLedgerEntry = z.infer<typeof leaveLedgerEntrySchema>;

export const leaveLedgerPostRequestSchema = z.strictObject({
  leaveTypeId: z.uuid(),
  kind: z.enum(['ACCRUAL', 'ADJUSTMENT']),
  days,
  effectiveDate: localDateSchema,
  note: z.string().trim().min(1).max(500),
});
export type LeaveLedgerPostRequest = z.infer<typeof leaveLedgerPostRequestSchema>;

export const leaveRequestSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  leaveTypeId: z.uuid(),
  leaveTypeCode: z.string(),
  leaveTypeName: z.string(),
  startDate: localDateSchema,
  endDate: localDateSchema,
  days: z.number(),
  reason: z.string(),
  status: z.enum(APPROVAL_STATUSES),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
});
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const createLeaveRequestSchema = z
  .strictObject({
    leaveTypeId: z.uuid(),
    startDate: localDateSchema,
    /** Inclusive. */
    endDate: localDateSchema,
    reason: z.string().trim().max(500).default(''),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'The end date must not be before the start date',
    path: ['endDate'],
  })
  .refine((v) => Date.parse(v.endDate) - Date.parse(v.startDate) < 60 * 86_400_000, {
    message: 'At most 60 days per request',
    path: ['endDate'],
  });
export type CreateLeaveRequest = z.infer<typeof createLeaveRequestSchema>;

export const leaveDecisionResultSchema = leaveRequestSchema.extend({
  /** Shifts that overlap approved leave; the scheduler should reassign them. */
  conflictingShifts: z.array(shiftSchema),
});
export type LeaveDecisionResult = z.infer<typeof leaveDecisionResultSchema>;

export const leaveRequestListQuerySchema = z.object({
  status: z.enum(APPROVAL_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type LeaveRequestListQuery = z.infer<typeof leaveRequestListQuerySchema>;

export const employeeLeaveSchema = z.object({
  balances: z.array(leaveBalanceSchema),
  ledger: z.array(leaveLedgerEntrySchema),
  requests: z.array(leaveRequestSchema),
});
export type EmployeeLeave = z.infer<typeof employeeLeaveSchema>;

// ---- Birthdays -----------------------------------------------------------------------------

/** Never carries the year (blueprint §13.5). */
export const birthdaySchema = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});
export type Birthday = z.infer<typeof birthdaySchema>;

// ---- Self service ----------------------------------------------------------------------------

export const myEmployeeSchema = z.object({
  employee: employeeSummarySchema.nullable(),
  /** Latest punch, for the clock-in / clock-out button state. */
  lastPunch: punchSchema.nullable(),
});
export type MyEmployee = z.infer<typeof myEmployeeSchema>;
