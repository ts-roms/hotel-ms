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
import type { Transport } from '../http.js';

/** Organization HR: departments, employees, documents, records and leave types. */
export function hrClient({ call, qs, baseUrl }: Transport) {
  return {
    hr: {
      departments: () =>
        call<{ items: Department[] }>('GET', '/departments').then((r) => r.data.items),
      employees: (query: Partial<EmployeeListQuery> = {}) =>
        call<{ items: EmployeeSummary[] }>('GET', `/employees${qs(query)}`).then(
          (r) => r.data.items,
        ),
      employee: (id: string) =>
        call<Employee>('GET', `/employees/${encodeURIComponent(id)}`).then((r) => r.data),
      createEmployee: (body: CreateEmployeeRequest) =>
        call<Employee>('POST', '/employees', body).then((r) => r.data),
      updateEmployee: (id: string, version: number, body: UpdateEmployeeRequest) =>
        call<Employee>('PATCH', `/employees/${encodeURIComponent(id)}`, body, {
          'if-match': `W/"${version}"`,
        }).then((r) => r.data),
      addAssignment: (id: string, body: NewAssignment) =>
        call<Employee>('POST', `/employees/${encodeURIComponent(id)}/assignments`, body).then(
          (r) => r.data,
        ),
      endAssignment: (id: string, assignmentId: string, endDate: string) =>
        call<Employee>(
          'POST',
          `/employees/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}/end`,
          { endDate },
        ).then((r) => r.data),
      terminate: (id: string, terminatedOn: string) =>
        call<Employee>('POST', `/employees/${encodeURIComponent(id)}/terminate`, {
          terminatedOn,
        }).then((r) => r.data),
      compensation: (id: string) =>
        call<CompensationHistory>('GET', `/employees/${encodeURIComponent(id)}/compensation`).then(
          (r) => r.data,
        ),
      addCompensation: (id: string, body: CreateCompensationInput) =>
        call<CompensationHistory>(
          'POST',
          `/employees/${encodeURIComponent(id)}/compensation`,
          body,
        ).then((r) => r.data),
      trainings: (id: string) =>
        call<{ items: TrainingRecord[] }>(
          'GET',
          `/employees/${encodeURIComponent(id)}/training`,
        ).then((r) => r.data.items),
      addTraining: (id: string, body: CreateTrainingInput) =>
        call<{ items: TrainingRecord[] }>(
          'POST',
          `/employees/${encodeURIComponent(id)}/training`,
          body,
        ).then((r) => r.data.items),
      removeTraining: (id: string, recordId: string) =>
        call<void>(
          'DELETE',
          `/employees/${encodeURIComponent(id)}/training/${encodeURIComponent(recordId)}`,
        ).then((r) => r.data),
      reviews: (id: string) =>
        call<{ items: PerformanceReview[] }>(
          'GET',
          `/employees/${encodeURIComponent(id)}/reviews`,
        ).then((r) => r.data.items),
      addReview: (id: string, body: CreatePerformanceReviewInput) =>
        call<{ items: PerformanceReview[] }>(
          'POST',
          `/employees/${encodeURIComponent(id)}/reviews`,
          body,
        ).then((r) => r.data.items),
      documents: (id: string) =>
        call<{ items: EmployeeDocument[] }>(
          'GET',
          `/employees/${encodeURIComponent(id)}/documents`,
        ).then((r) => r.data.items),
      uploadDocument: (
        id: string,
        file: Blob,
        meta: { category: string; title: string; fileName: string; expiresOn?: string },
      ) =>
        call<EmployeeDocument>(
          'POST',
          `/employees/${encodeURIComponent(id)}/documents${qs(meta)}`,
          file,
        ).then((r) => r.data),
      photoRetention: () =>
        call<PhotoRetention>('GET', '/attendance-photo-retention').then((r) => r.data),
      setPhotoRetention: (days: number) =>
        call<PhotoRetention>('PUT', '/attendance-photo-retention', { days }).then((r) => r.data),
      documentRetention: () =>
        call<DocumentRetention>('GET', '/document-retention').then((r) => r.data),
      setDocumentRetention: (rules: DocumentRetention['rules']) =>
        call<DocumentRetention>('PUT', '/document-retention', { rules }).then((r) => r.data),
      /** Same-origin download link; the session cookie authenticates. */
      documentUrl: (id: string, documentId: string) =>
        `${baseUrl}/employees/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/content`,
      deleteDocument: (id: string, documentId: string) =>
        call<void>(
          'DELETE',
          `/employees/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`,
        ).then((r) => r.data),
      employeeLeave: (id: string) =>
        call<EmployeeLeave>('GET', `/employees/${encodeURIComponent(id)}/leave`).then(
          (r) => r.data,
        ),
      postLeave: (id: string, body: LeaveLedgerPostRequest) =>
        call<EmployeeLeave>(
          'POST',
          `/employees/${encodeURIComponent(id)}/leave/entries`,
          body,
        ).then((r) => r.data),
      leaveTypes: () =>
        call<{ items: LeaveType[] }>('GET', '/leave-types').then((r) => r.data.items),
      createLeaveType: (body: CreateLeaveTypeRequest) =>
        call<LeaveType>('POST', '/leave-types', body).then((r) => r.data),
      updateLeaveType: (leaveTypeId: string, body: UpdateLeaveTypeRequest) =>
        call<LeaveType>('PATCH', `/leave-types/${encodeURIComponent(leaveTypeId)}`, body).then(
          (r) => r.data,
        ),
    },
  };
}
