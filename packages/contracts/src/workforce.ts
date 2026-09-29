import { z } from 'zod';
import { localDateSchema } from './common.js';
import { hrCodeSchema as code, hrNameSchema as name } from './internal.js';

/**
 * Workforce contracts (blueprint §13): departments and positions, employees and their
 * employment assignments, employee documents, birthdays, and employee records (pay,
 * training, performance).
 */

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

export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'PROBATIONARY',
  'CONTRACTUAL',
  'SEASONAL',
  'INTERN',
] as const;

export const emergencyContactSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
});
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

/** Present only for callers with employee.personal.read covering the employee. */
export const employeePersonalSchema = z.object({
  birthDate: localDateSchema.nullable(),
  personalEmail: z.string().nullable(),
  personalPhone: z.string().nullable(),
  emergencyContact: emergencyContactSchema.nullable(),
});
export type EmployeePersonal = z.infer<typeof employeePersonalSchema>;

export const employeeSchema = employeeSummarySchema.extend({
  workEmail: z.string().nullable(),
  workPhone: z.string().nullable(),
  hireDate: localDateSchema,
  terminatedOn: localDateSchema.nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  birthdayVisibility: z.enum(BIRTHDAY_VISIBILITIES),
  membershipId: z.uuid().nullable(),
  /** All assignments, past and future included. */
  assignmentHistory: z.array(assignmentSchema),
  personal: employeePersonalSchema.nullable(),
  version: z.number().int(),
});
export type Employee = z.infer<typeof employeeSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable();

const emergencyContactInput = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().max(60).default(''),
    phone: z.string().trim().min(3).max(40),
  })
  .nullable();

// ---- Employee documents (ADR-0019) -----------------------------------------------------------

export const EMPLOYEE_DOCUMENT_CATEGORIES = [
  'CONTRACT',
  'GOVERNMENT_ID',
  'TAX',
  'MEDICAL',
  'CERTIFICATE',
  'OTHER',
] as const;

/** File types accepted for employee documents (checked against the file's own bytes). */
export const EMPLOYEE_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** Largest accepted file: 8 MiB. */
export const EMPLOYEE_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

export const employeeDocumentSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  category: z.enum(EMPLOYEE_DOCUMENT_CATEGORIES),
  title: z.string(),
  fileName: z.string(),
  contentType: z.enum(EMPLOYEE_DOCUMENT_TYPES),
  sizeBytes: z.number().int(),
  /** Hex SHA-256 of the file, for integrity checks. */
  sha256: z.string(),
  /** e.g. when a government ID or permit expires. */
  expiresOn: localDateSchema.nullable(),
  uploadedByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** When the retention rules delete it (employee terminated and a rule applies). */
  purgeOn: localDateSchema.nullable(),
});
export type EmployeeDocument = z.infer<typeof employeeDocumentSchema>;

/**
 * Retention per category (ADR-0021): months after the employee's termination date, after
 * which the document is deleted. Null: kept until deleted by hand.
 */
export const documentRetentionSchema = z.strictObject({
  rules: z.strictObject(
    Object.fromEntries(
      EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => [c, z.number().int().min(1).max(1200).nullable()]),
    ) as Record<(typeof EMPLOYEE_DOCUMENT_CATEGORIES)[number], z.ZodNullable<z.ZodNumber>>,
  ),
});
export type DocumentRetention = z.infer<typeof documentRetentionSchema>;

/**
 * Upload metadata travels in the query string; the request body is the file itself, with
 * its Content-Type (no multipart parsing).
 */
export const uploadEmployeeDocumentQuerySchema = z.strictObject({
  category: z.enum(EMPLOYEE_DOCUMENT_CATEGORIES),
  title: z.string().trim().min(1).max(120),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (v) => ![...v].some((c) => c === '/' || c === '\\' || c.charCodeAt(0) < 0x20),
      'Not a valid file name',
    ),
  expiresOn: localDateSchema.optional(),
});
export type UploadEmployeeDocumentQuery = z.infer<typeof uploadEmployeeDocumentQuerySchema>;

export const newAssignmentSchema = z.strictObject({
  propertyId: z.uuid(),
  departmentId: z.uuid(),
  positionId: z.uuid().nullable().default(null),
  startDate: localDateSchema,
  endDate: localDateSchema.nullable().default(null),
  isPrimary: z.boolean().default(false),
});
export type NewAssignment = z.infer<typeof newAssignmentSchema>;
/** What a client sends: fields with defaults may be left out. */
export type NewAssignmentInput = z.input<typeof newAssignmentSchema>;

export const createEmployeeRequestSchema = z.strictObject({
  employeeNo: z.string().trim().min(1).max(30),
  firstName: name,
  lastName: name,
  preferredName: optionalText(100).default(null),
  workEmail: z.email().max(254).nullable().default(null),
  workPhone: optionalText(40).default(null),
  hireDate: localDateSchema,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  birthdayVisibility: z.enum(BIRTHDAY_VISIBILITIES).default('HIDDEN'),
  personal: z
    .strictObject({
      birthDate: localDateSchema.nullable().default(null),
      personalEmail: z.email().max(254).nullable().default(null),
      personalPhone: optionalText(40).default(null),
      emergencyContact: emergencyContactInput.default(null),
    })
    .optional(),
  /** Every employee starts with an assignment, so someone in scope can see them. */
  assignment: newAssignmentSchema,
});
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateEmployeeRequestInput = z.input<typeof createEmployeeRequestSchema>;

export const updateEmployeeRequestSchema = z
  .strictObject({
    firstName: name,
    lastName: name,
    preferredName: optionalText(100),
    workEmail: z.email().max(254).nullable(),
    workPhone: optionalText(40),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    birthdayVisibility: z.enum(BIRTHDAY_VISIBILITIES),
    personal: z
      .strictObject({
        birthDate: localDateSchema.nullable(),
        personalEmail: z.email().max(254).nullable(),
        personalPhone: optionalText(40),
        emergencyContact: emergencyContactInput,
      })
      .partial(),
  })
  .partial();
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type UpdateEmployeeRequestInput = z.input<typeof updateEmployeeRequestSchema>;

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

// ---- Birthdays -----------------------------------------------------------------------------

/** Never carries the year (blueprint §13.5). */
export const birthdaySchema = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});
export type Birthday = z.infer<typeof birthdaySchema>;

// ---- Employee records (ADR-0028) -------------------------------------------------------------

export const PAY_BASES = ['MONTHLY', 'DAILY', 'HOURLY'] as const;

/** Pay records: sensitive (employee.compensation), start-dated, never edited. */
export const compensationSchema = z.object({
  id: z.uuid(),
  effectiveFrom: localDateSchema,
  payBasis: z.enum(PAY_BASES),
  amountMinor: z.number().int(),
  currency: z.string(),
  notes: z.string(),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Compensation = z.infer<typeof compensationSchema>;

export const compensationHistorySchema = z.object({
  /** In effect today (the latest start on or before today). */
  current: compensationSchema.nullable(),
  history: z.array(compensationSchema),
});
export type CompensationHistory = z.infer<typeof compensationHistorySchema>;

export const createCompensationRequestSchema = z.strictObject({
  effectiveFrom: localDateSchema,
  payBasis: z.enum(PAY_BASES),
  amountMinor: z.number().int().min(0).max(1_000_000_000_00),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'Three-letter currency code'),
  notes: z.string().trim().max(500).default(''),
});
export type CreateCompensationRequest = z.infer<typeof createCompensationRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateCompensationRequestInput = z.input<typeof createCompensationRequestSchema>;
export type CreateCompensationInput = z.input<typeof createCompensationRequestSchema>;

export const TRAINING_KINDS = ['TRAINING', 'CERTIFICATION'] as const;

export const trainingRecordSchema = z.object({
  id: z.uuid(),
  kind: z.enum(TRAINING_KINDS),
  title: z.string(),
  provider: z.string(),
  completedOn: localDateSchema.nullable(),
  expiresOn: localDateSchema.nullable(),
  /** Expired, or expiring within 30 days. */
  expiry: z.enum(['VALID', 'EXPIRING', 'EXPIRED']).nullable(),
  notes: z.string(),
  documentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type TrainingRecord = z.infer<typeof trainingRecordSchema>;

export const createTrainingRequestSchema = z
  .strictObject({
    kind: z.enum(TRAINING_KINDS),
    title: z.string().trim().min(1).max(160),
    provider: z.string().trim().max(160).default(''),
    completedOn: localDateSchema.nullable().default(null),
    expiresOn: localDateSchema.nullable().default(null),
    notes: z.string().trim().max(1000).default(''),
    /** An uploaded employee document (e.g. the certificate). */
    documentId: z.uuid().nullable().default(null),
  })
  .refine((t) => !t.completedOn || !t.expiresOn || t.expiresOn >= t.completedOn, {
    message: 'Expires before it was completed',
    path: ['expiresOn'],
  });
export type CreateTrainingRequest = z.infer<typeof createTrainingRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreateTrainingRequestInput = z.input<typeof createTrainingRequestSchema>;
export type CreateTrainingInput = z.input<typeof createTrainingRequestSchema>;

/** Performance records: sensitive (employee.performance). */
export const performanceReviewSchema = z.object({
  id: z.uuid(),
  reviewDate: localDateSchema,
  periodFrom: localDateSchema.nullable(),
  periodTo: localDateSchema.nullable(),
  /** 1 (unsatisfactory) to 5 (outstanding). */
  rating: z.number().int().min(1).max(5),
  summary: z.string(),
  strengths: z.string(),
  improvements: z.string(),
  goals: z.string(),
  reviewerName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type PerformanceReview = z.infer<typeof performanceReviewSchema>;

export const createPerformanceReviewRequestSchema = z
  .strictObject({
    reviewDate: localDateSchema,
    periodFrom: localDateSchema.nullable().default(null),
    periodTo: localDateSchema.nullable().default(null),
    rating: z.number().int().min(1).max(5),
    summary: z.string().trim().min(1).max(4000),
    strengths: z.string().trim().max(4000).default(''),
    improvements: z.string().trim().max(4000).default(''),
    goals: z.string().trim().max(4000).default(''),
  })
  .refine((r) => !r.periodFrom || !r.periodTo || r.periodTo >= r.periodFrom, {
    message: 'The period ends before it starts',
    path: ['periodTo'],
  });
export type CreatePerformanceReviewRequest = z.infer<typeof createPerformanceReviewRequestSchema>;
/** What a client sends: fields with defaults may be left out. */
export type CreatePerformanceReviewRequestInput = z.input<
  typeof createPerformanceReviewRequestSchema
>;
export type CreatePerformanceReviewInput = z.input<typeof createPerformanceReviewRequestSchema>;
