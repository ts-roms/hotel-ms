import type {
  CompensationHistory,
  CreateCompensationInput,
  CreateEmployeeRequest,
  CreateLeaveTypeRequest,
  CreatePerformanceReviewInput,
  CreateTrainingInput,
  Department,
  DocumentRetention,
  Employee,
  EmployeeDocument,
  EmployeeLeave,
  EmployeeListQuery,
  EmployeeSummary,
  LeaveLedgerPostRequest,
  LeaveType,
  NewAssignment,
  PerformanceReview,
  PhotoRetention,
  TrainingRecord,
  UpdateEmployeeRequest,
  UpdateLeaveTypeRequest,
} from '@hotel/contracts';
import * as op from '../generated/operations.js';
import { data, items, type Transport } from '../http.js';

/** Organization HR: departments, employees, documents, records and leave types. */
export function hrClient({ call, baseUrl }: Transport) {
  return {
    hr: {
      departments: () => op.HrController_departments<{ items: Department[] }>(call).then(items),
      employees: (query: Partial<EmployeeListQuery> = {}) =>
        op.HrController_employees<{ items: EmployeeSummary[] }>(call, query).then(items),
      employee: (id: string) =>
        op.HrController_employee<Employee>(call, { employeeId: id }).then(data),
      createEmployee: (body: CreateEmployeeRequest) =>
        op.HrController_createEmployee<Employee>(call, body).then(data),
      updateEmployee: (id: string, version: number, body: UpdateEmployeeRequest) =>
        op
          .HrController_updateEmployee<Employee>(call, { employeeId: id }, body, {
            ifMatch: `W/"${version}"`,
          })
          .then(data),
      addAssignment: (id: string, body: NewAssignment) =>
        op.HrController_addAssignment<Employee>(call, { employeeId: id }, body).then(data),
      endAssignment: (id: string, assignmentId: string, endDate: string) =>
        op
          .HrController_endAssignment<Employee>(call, { employeeId: id, assignmentId }, { endDate })
          .then(data),
      terminate: (id: string, terminatedOn: string) =>
        op.HrController_terminate<Employee>(call, { employeeId: id }, { terminatedOn }).then(data),
      compensation: (id: string) =>
        op
          .EmployeeRecordsController_compensation<CompensationHistory>(call, { employeeId: id })
          .then(data),
      addCompensation: (id: string, body: CreateCompensationInput) =>
        op
          .EmployeeRecordsController_addCompensation<CompensationHistory>(
            call,
            { employeeId: id },
            body,
          )
          .then(data),
      trainings: (id: string) =>
        op
          .EmployeeRecordsController_trainings<{ items: TrainingRecord[] }>(call, {
            employeeId: id,
          })
          .then(items),
      addTraining: (id: string, body: CreateTrainingInput) =>
        op
          .EmployeeRecordsController_addTraining<{ items: TrainingRecord[] }>(
            call,
            { employeeId: id },
            body,
          )
          .then(items),
      removeTraining: (id: string, recordId: string) =>
        op.EmployeeRecordsController_removeTraining(call, { employeeId: id, recordId }).then(data),
      reviews: (id: string) =>
        op
          .EmployeeRecordsController_reviews<{ items: PerformanceReview[] }>(call, {
            employeeId: id,
          })
          .then(items),
      addReview: (id: string, body: CreatePerformanceReviewInput) =>
        op
          .EmployeeRecordsController_addReview<{ items: PerformanceReview[] }>(
            call,
            { employeeId: id },
            body,
          )
          .then(items),
      documents: (id: string) =>
        op
          .EmployeeDocumentsController_list<{ items: EmployeeDocument[] }>(call, { employeeId: id })
          .then(items),
      uploadDocument: (
        id: string,
        file: Blob,
        meta: { category: string; title: string; fileName: string; expiresOn?: string },
      ) =>
        op
          .EmployeeDocumentsController_upload<EmployeeDocument>(
            call,
            { employeeId: id },
            meta,
            file,
          )
          .then(data),
      photoRetention: () => op.PhotoRetentionController_get<PhotoRetention>(call).then(data),
      setPhotoRetention: (days: number) =>
        op.PhotoRetentionController_set<PhotoRetention>(call, { days }).then(data),
      documentRetention: () =>
        op.DocumentRetentionController_get<DocumentRetention>(call).then(data),
      setDocumentRetention: (rules: DocumentRetention['rules']) =>
        op.DocumentRetentionController_set<DocumentRetention>(call, { rules }).then(data),
      /** Same-origin download link; the session cookie authenticates. */
      documentUrl: (id: string, documentId: string) =>
        `${baseUrl}${op.paths.EmployeeDocumentsController_download({ employeeId: id, documentId })}`,
      deleteDocument: (id: string, documentId: string) =>
        op.EmployeeDocumentsController_remove(call, { employeeId: id, documentId }).then(data),
      employeeLeave: (id: string) =>
        op.LeaveController_employeeLeave<EmployeeLeave>(call, { employeeId: id }).then(data),
      postLeave: (id: string, body: LeaveLedgerPostRequest) =>
        op.LeaveController_postLedger<EmployeeLeave>(call, { employeeId: id }, body).then(data),
      leaveTypes: () => op.LeaveController_leaveTypes<{ items: LeaveType[] }>(call).then(items),
      createLeaveType: (body: CreateLeaveTypeRequest) =>
        op.LeaveController_createLeaveType<LeaveType>(call, body).then(data),
      updateLeaveType: (leaveTypeId: string, body: UpdateLeaveTypeRequest) =>
        op.LeaveController_updateLeaveType<LeaveType>(call, { leaveTypeId }, body).then(data),
    },
  };
}
