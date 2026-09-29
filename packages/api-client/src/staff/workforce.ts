import type {
  CompensationHistory,
  CreateCompensationInput,
  CreateEmployeeRequest,
  CreatePerformanceReviewInput,
  CreateTrainingInput,
  Department,
  DocumentRetention,
  Employee,
  EmployeeDocument,
  EmployeeListQuery,
  EmployeeSummary,
  NewAssignment,
  PerformanceReview,
  TrainingRecord,
  UpdateEmployeeRequest,
  UploadEmployeeDocumentQuery,
} from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, items, type Transport } from '../http.js';

/**
 * An employee document's metadata (UploadEmployeeDocumentQuery). `category` stays a string
 * here because the staff app passes one from its select; the API validates it.
 */
type DocumentMeta = Omit<UploadEmployeeDocumentQuery, 'category'> & { category: string };

/** HR workforce: departments, employees, their records and documents (the `hr` group, with time.ts). */
export function workforceClient({ call, baseUrl }: Transport) {
  return {
    hr: {
      departments: () => op.HrController_departments<{ items: Department[] }>(call).then(items),
      employees: (query: Partial<EmployeeListQuery> = {}) =>
        op.HrController_employees<{ items: EmployeeSummary[] }>(call, query).then(items),
      employee: (employeeId: string) =>
        op.HrController_employee<Employee>(call, { employeeId }).then(data),
      createEmployee: (body: CreateEmployeeRequest) =>
        op.HrController_createEmployee<Employee>(call, body).then(data),
      updateEmployee: (employeeId: string, version: number, body: UpdateEmployeeRequest) =>
        op
          .HrController_updateEmployee<Employee>(call, { employeeId }, body, {
            ifMatch: `W/"${version}"`,
          })
          .then(data),
      addAssignment: (employeeId: string, body: NewAssignment) =>
        op.HrController_addAssignment<Employee>(call, { employeeId }, body).then(data),
      endAssignment: (employeeId: string, assignmentId: string, endDate: string) =>
        op
          .HrController_endAssignment<Employee>(call, { employeeId, assignmentId }, { endDate })
          .then(data),
      terminate: (employeeId: string, terminatedOn: string) =>
        op.HrController_terminate<Employee>(call, { employeeId }, { terminatedOn }).then(data),
      compensation: (employeeId: string) =>
        op
          .EmployeeRecordsController_compensation<CompensationHistory>(call, { employeeId })
          .then(data),
      addCompensation: (employeeId: string, body: CreateCompensationInput) =>
        op
          .EmployeeRecordsController_addCompensation<CompensationHistory>(
            call,
            { employeeId },
            body,
          )
          .then(data),
      trainings: (employeeId: string) =>
        op
          .EmployeeRecordsController_trainings<{ items: TrainingRecord[] }>(call, { employeeId })
          .then(items),
      addTraining: (employeeId: string, body: CreateTrainingInput) =>
        op
          .EmployeeRecordsController_addTraining<{ items: TrainingRecord[] }>(
            call,
            { employeeId },
            body,
          )
          .then(items),
      removeTraining: (employeeId: string, recordId: string) =>
        op.EmployeeRecordsController_removeTraining(call, { employeeId, recordId }).then(data),
      reviews: (employeeId: string) =>
        op
          .EmployeeRecordsController_reviews<{ items: PerformanceReview[] }>(call, { employeeId })
          .then(items),
      addReview: (employeeId: string, body: CreatePerformanceReviewInput) =>
        op
          .EmployeeRecordsController_addReview<{ items: PerformanceReview[] }>(
            call,
            { employeeId },
            body,
          )
          .then(items),
      documents: (employeeId: string) =>
        op
          .EmployeeDocumentsController_list<{ items: EmployeeDocument[] }>(call, { employeeId })
          .then(items),
      uploadDocument: (employeeId: string, file: Blob, meta: DocumentMeta) =>
        op
          .EmployeeDocumentsController_upload<EmployeeDocument>(call, { employeeId }, meta, file)
          .then(data),
      /** Same-origin download link; the session cookie authenticates. */
      documentUrl: (employeeId: string, documentId: string) =>
        `${baseUrl}${op.paths.EmployeeDocumentsController_download({ employeeId, documentId })}`,
      deleteDocument: (employeeId: string, documentId: string) =>
        op.EmployeeDocumentsController_remove(call, { employeeId, documentId }).then(data),
      documentRetention: () =>
        op.DocumentRetentionController_get<DocumentRetention>(call).then(data),
      setDocumentRetention: (rules: DocumentRetention['rules']) =>
        op.DocumentRetentionController_set<DocumentRetention>(call, { rules }).then(data),
    },
  };
}
