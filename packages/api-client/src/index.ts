import type {
  FeatureFlag,
  GuestBill,
  GuestServiceRequestCreate,
  GuestStay,
  PreCheckInRequest,
  SelfCheckInResult,
  ServiceRequest,
  ServiceRequestListQuery,
  ServiceRequestUpdate,
  StaffServiceRequestCreate,
  AcceptInvitationRequest,
  AdjustmentRequest,
  BusinessDayClosing,
  CreateHousekeepingTaskRequest,
  Folio,
  FrontDesk,
  HousekeepingBoard,
  HousekeepingTask,
  NightAuditPreview,
  PostChargeRequest,
  RecordPaymentRequest,
  SetHousekeepingStatusRequest,
  TaxRule,
  AssignRoomRequest,
  Availability,
  Building,
  CreateBuildingRequest,
  CreateGuestRequest,
  CreateRatePlanRequest,
  CreateReservationRequest,
  CreateRoomBlockRequest,
  CreateRoomRequest,
  CreateRoomTypeRequest,
  Guest,
  Quote,
  RatePlan,
  Reservation,
  Room,
  RoomBlock,
  RoomType,
  SetRateOverridesRequest,
  UpdateRatePlanRequest,
  UpdateReservationRoomRequest,
  AssignmentRequest,
  AuditLogEntry,
  ChangePasswordRequest,
  CreatePropertyRequest,
  CreateRoleRequest,
  InvitationPreview,
  InviteMemberRequest,
  LoginRequest,
  Member,
  MfaChallengeRequest,
  PermissionInfo,
  Problem,
  Property,
  RecoveryCodes,
  ResetPasswordRequest,
  RoleDto,
  SessionInfo,
  TotpEnrollment,
  UpdateMemberRequest,
  UpdatePropertyRequest,
  UpdateRoleRequest,
} from '@hotel/contracts';

/**
 * Thin typed client over the REST API, sharing request/response types with the server
 * through @hotel/contracts. (Generation from docs/api/openapi.json replaces this when the
 * surface grows; see ADR-0009.)
 *
 * Calls go to same-origin `/api/v1/...`; the web app proxies them to the API, so the
 * session cookie is first-party and CORS is not involved in the browser.
 */
export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
  get status(): number {
    return this.problem.status;
  }
  get code(): Problem['code'] {
    return this.problem.code;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** Returns the CSRF token from the last session response. */
  getCsrfToken?: () => string | undefined;
  fetch?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function createCaller(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? '/api/v1';
  const doFetch = options.fetch ?? fetch;

  async function call<T>(
    method: Method,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ data: T; etag: string | null }> {
    const csrf = method === 'GET' ? undefined : options.getCsrfToken?.();
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => null)) as Problem | null;
      throw new ApiError(
        problem ?? {
          type: 'about:blank',
          title: res.statusText,
          status: res.status,
          code: 'INTERNAL_ERROR',
        },
      );
    }
    const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    return { data, etag: res.headers.get('etag') };
  }

  const qs = (params: Record<string, string | number | undefined>) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
    return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
  };
  return { call, qs };
}

export function createApiClient(options: ApiClientOptions = {}) {
  const { call, qs } = createCaller(options);

  return {
    auth: {
      login: (body: LoginRequest) =>
        call<SessionInfo>('POST', '/auth/login', body).then((r) => r.data),
      mfaChallenge: (body: MfaChallengeRequest) =>
        call<SessionInfo>('POST', '/auth/mfa/challenge', body).then((r) => r.data),
      startTotpEnrollment: () =>
        call<TotpEnrollment>('POST', '/auth/mfa/totp/enrollment').then((r) => r.data),
      confirmTotpEnrollment: (code: string) =>
        call<RecoveryCodes & { session: SessionInfo }>(
          'POST',
          '/auth/mfa/totp/enrollment/confirm',
          {
            code,
          },
        ).then((r) => r.data),
      regenerateRecoveryCodes: (code: string) =>
        call<RecoveryCodes>('POST', '/auth/mfa/recovery-codes', { code }).then((r) => r.data),
      disableMfa: (body: MfaChallengeRequest) =>
        call<void>('POST', '/auth/mfa/disable', body).then((r) => r.data),
      forgotPassword: (email: string) =>
        call<object>('POST', '/auth/password/forgot', { email }).then((r) => r.data),
      resetPassword: (body: ResetPasswordRequest) =>
        call<void>('POST', '/auth/password/reset', body).then((r) => r.data),
      changePassword: (body: ChangePasswordRequest) =>
        call<void>('POST', '/auth/password/change', body).then((r) => r.data),
      previewInvitation: (token: string) =>
        call<InvitationPreview>('POST', '/auth/invitations/preview', { token }).then((r) => r.data),
      acceptInvitation: (body: AcceptInvitationRequest) =>
        call<void>('POST', '/auth/invitations/accept', body).then((r) => r.data),
      logout: () => call<void>('POST', '/auth/logout').then((r) => r.data),
      session: () => call<SessionInfo>('GET', '/auth/session').then((r) => r.data),
      switchOrganization: (organizationId: string) =>
        call<SessionInfo>('POST', '/auth/switch-organization', { organizationId }).then(
          (r) => r.data,
        ),
    },
    properties: {
      list: (params: { cursor?: string; limit?: number } = {}) =>
        call<Page<Property>>('GET', `/properties${qs(params)}`).then((r) => r.data),
      get: (id: string) => call<Property>('GET', `/properties/${encodeURIComponent(id)}`),
      create: (body: CreatePropertyRequest) =>
        call<Property>('POST', '/properties', body).then((r) => r.data),
      update: (id: string, etag: string, body: UpdatePropertyRequest) =>
        call<Property>('PATCH', `/properties/${encodeURIComponent(id)}`, body, {
          'if-match': etag,
        }),
    },
    access: {
      permissions: () => call<PermissionInfo[]>('GET', '/permissions').then((r) => r.data),
      roles: () => call<RoleDto[]>('GET', '/roles').then((r) => r.data),
      getRole: (id: string) => call<RoleDto>('GET', `/roles/${encodeURIComponent(id)}`),
      createRole: (body: CreateRoleRequest) =>
        call<RoleDto>('POST', '/roles', body).then((r) => r.data),
      updateRole: (id: string, etag: string, body: UpdateRoleRequest) =>
        call<RoleDto>('PATCH', `/roles/${encodeURIComponent(id)}`, body, { 'if-match': etag }),
      deleteRole: (id: string) =>
        call<void>('DELETE', `/roles/${encodeURIComponent(id)}`).then((r) => r.data),
      members: () => call<Member[]>('GET', '/members').then((r) => r.data),
      invite: (body: InviteMemberRequest) =>
        call<Member>('POST', '/members/invitations', body).then((r) => r.data),
      resendInvitation: (membershipId: string) =>
        call<void>('POST', `/members/${encodeURIComponent(membershipId)}/invitation`).then(
          (r) => r.data,
        ),
      updateMember: (membershipId: string, body: UpdateMemberRequest) =>
        call<Member>('PATCH', `/members/${encodeURIComponent(membershipId)}`, body).then(
          (r) => r.data,
        ),
      addAssignment: (membershipId: string, body: AssignmentRequest) =>
        call<Member>(
          'POST',
          `/members/${encodeURIComponent(membershipId)}/role-assignments`,
          body,
        ).then((r) => r.data),
      removeAssignment: (membershipId: string, assignmentId: string) =>
        call<Member>(
          'DELETE',
          `/members/${encodeURIComponent(membershipId)}/role-assignments/${encodeURIComponent(assignmentId)}`,
        ).then((r) => r.data),
    },
    pms: (propertyId: string) => {
      const p = `/properties/${encodeURIComponent(propertyId)}`;
      const id = encodeURIComponent;
      return {
        buildings: () => call<Building[]>('GET', `${p}/buildings`).then((r) => r.data),
        createBuilding: (body: CreateBuildingRequest) =>
          call<Building>('POST', `${p}/buildings`, body).then((r) => r.data),
        roomTypes: () => call<RoomType[]>('GET', `${p}/room-types`).then((r) => r.data),
        createRoomType: (body: CreateRoomTypeRequest) =>
          call<RoomType>('POST', `${p}/room-types`, body).then((r) => r.data),
        rooms: () => call<Room[]>('GET', `${p}/rooms`).then((r) => r.data),
        createRoom: (body: CreateRoomRequest) =>
          call<Room>('POST', `${p}/rooms`, body).then((r) => r.data),
        roomBlocks: (roomId: string) =>
          call<RoomBlock[]>('GET', `${p}/rooms/${id(roomId)}/blocks`).then((r) => r.data),
        blockRoom: (roomId: string, body: CreateRoomBlockRequest) =>
          call<RoomBlock>('POST', `${p}/rooms/${id(roomId)}/blocks`, body).then((r) => r.data),
        releaseBlock: (roomId: string, blockId: string) =>
          call<void>('DELETE', `${p}/rooms/${id(roomId)}/blocks/${id(blockId)}`).then(
            (r) => r.data,
          ),
        ratePlans: () => call<RatePlan[]>('GET', `${p}/rate-plans`).then((r) => r.data),
        createRatePlan: (body: CreateRatePlanRequest) =>
          call<RatePlan>('POST', `${p}/rate-plans`, body).then((r) => r.data),
        updateRatePlan: (ratePlanId: string, version: number, body: UpdateRatePlanRequest) =>
          call<RatePlan>('PATCH', `${p}/rate-plans/${id(ratePlanId)}`, body, {
            'if-match': `W/"${version}"`,
          }).then((r) => r.data),
        setRateOverrides: (ratePlanId: string, body: SetRateOverridesRequest) =>
          call<void>('PUT', `${p}/rate-plans/${id(ratePlanId)}/overrides`, body).then(
            (r) => r.data,
          ),
        quote: (params: {
          roomTypeId: string;
          ratePlanId: string;
          arrivalDate: string;
          departureDate: string;
        }) => call<Quote>('GET', `${p}/quote${qs(params)}`).then((r) => r.data),
        availability: (from: string, to: string) =>
          call<Availability>('GET', `${p}/availability${qs({ from, to })}`).then((r) => r.data),
        createGuest: (body: CreateGuestRequest) =>
          call<Guest>('POST', `${p}/guests`, body).then((r) => r.data),
        reservations: (
          params: {
            q?: string;
            arrivalFrom?: string;
            arrivalTo?: string;
            status?: string;
            cursor?: string;
            limit?: number;
          } = {},
        ) => call<Page<Reservation>>('GET', `${p}/reservations${qs(params)}`).then((r) => r.data),
        reservation: (reservationId: string) =>
          call<Reservation>('GET', `${p}/reservations/${id(reservationId)}`).then((r) => r.data),
        createReservation: (body: CreateReservationRequest, idempotencyKey: string) =>
          call<Reservation>('POST', `${p}/reservations`, body, {
            'idempotency-key': idempotencyKey,
          }).then((r) => r.data),
        updateReservationRoom: (
          reservationId: string,
          lineId: string,
          version: number,
          body: UpdateReservationRoomRequest,
        ) =>
          call<Reservation>(
            'PATCH',
            `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}`,
            body,
            {
              'if-match': `W/"${version}"`,
            },
          ).then((r) => r.data),
        assignRoom: (reservationId: string, lineId: string, body: AssignRoomRequest) =>
          call<Reservation>(
            'PUT',
            `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/assignment`,
            body,
          ).then((r) => r.data),
        unassignRoom: (reservationId: string, lineId: string) =>
          call<Reservation>(
            'DELETE',
            `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/assignment`,
          ).then((r) => r.data),
        cancelReservation: (reservationId: string, reason: string) =>
          call<Reservation>('POST', `${p}/reservations/${id(reservationId)}/cancel`, {
            reason,
          }).then((r) => r.data),
        frontDesk: () => call<FrontDesk>('GET', `${p}/front-desk`).then((r) => r.data),
        checkIn: (reservationId: string, lineId: string) =>
          call<Reservation>(
            'POST',
            `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/check-in`,
          ).then((r) => r.data),
        checkOut: (reservationId: string, lineId: string) =>
          call<Reservation>(
            'POST',
            `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/check-out`,
          ).then((r) => r.data),
        folio: (folioId: string) =>
          call<Folio>('GET', `${p}/folios/${id(folioId)}`).then((r) => r.data),
        postCharge: (folioId: string, body: PostChargeRequest, idempotencyKey: string) =>
          call<Folio>('POST', `${p}/folios/${id(folioId)}/charges`, body, {
            'idempotency-key': idempotencyKey,
          }).then((r) => r.data),
        recordPayment: (folioId: string, body: RecordPaymentRequest, idempotencyKey: string) =>
          call<Folio>('POST', `${p}/folios/${id(folioId)}/payments`, body, {
            'idempotency-key': idempotencyKey,
          }).then((r) => r.data),
        adjust: (folioId: string, body: AdjustmentRequest, idempotencyKey: string) =>
          call<Folio>('POST', `${p}/folios/${id(folioId)}/adjustments`, body, {
            'idempotency-key': idempotencyKey,
          }).then((r) => r.data),
        voidLine: (folioId: string, lineId: string, reason: string) =>
          call<Folio>('POST', `${p}/folios/${id(folioId)}/lines/${id(lineId)}/void`, {
            reason,
          }).then((r) => r.data),
        taxRules: () => call<TaxRule[]>('GET', `${p}/tax-rules`).then((r) => r.data),
        housekeeping: () => call<HousekeepingBoard>('GET', `${p}/housekeeping`).then((r) => r.data),
        housekeepingStaff: () =>
          call<{ membershipId: string; displayName: string }[]>(
            'GET',
            `${p}/housekeeping/staff`,
          ).then((r) => r.data),
        setHousekeepingStatus: (roomId: string, body: SetHousekeepingStatusRequest) =>
          call<HousekeepingBoard['rooms'][number]>(
            'PUT',
            `${p}/rooms/${id(roomId)}/housekeeping-status`,
            body,
          ).then((r) => r.data),
        createHousekeepingTask: (body: CreateHousekeepingTaskRequest) =>
          call<HousekeepingTask>('POST', `${p}/housekeeping/tasks`, body).then((r) => r.data),
        assignHousekeepingTask: (taskId: string, assignedMembershipId: string | null) =>
          call<HousekeepingTask>('PUT', `${p}/housekeeping/tasks/${id(taskId)}/assignee`, {
            assignedMembershipId,
          }).then((r) => r.data),
        nightAuditPreview: () =>
          call<NightAuditPreview>('GET', `${p}/night-audit`).then((r) => r.data),
        runNightAudit: (businessDate: string) =>
          call<BusinessDayClosing>('POST', `${p}/night-audit`, { businessDate }).then(
            (r) => r.data,
          ),
        businessDays: () =>
          call<BusinessDayClosing[]>('GET', `${p}/business-days`).then((r) => r.data),
        sendGuestPortalLink: (reservationId: string) =>
          call<void>('POST', `${p}/reservations/${id(reservationId)}/guest-portal-link`).then(
            (r) => r.data,
          ),
        serviceRequests: (query: Partial<ServiceRequestListQuery> = {}) =>
          call<{ items: ServiceRequest[] }>('GET', `${p}/service-requests${qs(query)}`).then(
            (r) => r.data.items,
          ),
        serviceRequestAssignees: () =>
          call<{ items: { membershipId: string; displayName: string }[] }>(
            'GET',
            `${p}/service-requests/assignees`,
          ).then((r) => r.data.items),
        createServiceRequest: (body: StaffServiceRequestCreate) =>
          call<ServiceRequest>('POST', `${p}/service-requests`, body).then((r) => r.data),
        updateServiceRequest: (requestId: string, version: number, body: ServiceRequestUpdate) =>
          call<ServiceRequest>('PATCH', `${p}/service-requests/${id(requestId)}`, body, {
            'if-match': `W/"${version}"`,
          }).then((r) => r.data),
        cancelReservationRoom: (reservationId: string, lineId: string, reason: string) =>
          call<Reservation>(
            'POST',
            `${p}/reservations/${id(reservationId)}/rooms/${id(lineId)}/cancel`,
            { reason },
          ).then((r) => r.data),
      };
    },
    featureFlags: {
      list: () =>
        call<{ items: FeatureFlag[] }>('GET', '/organization/feature-flags').then(
          (r) => r.data.items,
        ),
      set: (key: string, enabled: boolean) =>
        call<FeatureFlag>('PUT', `/organization/feature-flags/${encodeURIComponent(key)}`, {
          enabled,
        }).then((r) => r.data),
    },
    guests: {
      search: (q: string, limit = 20) =>
        call<Guest[]>('GET', `/guests${qs({ q, limit })}`).then((r) => r.data),
    },
    auditLogs: {
      list: (
        params: {
          propertyId?: string;
          entityType?: string;
          entityId?: string;
          cursor?: string;
          limit?: number;
        } = {},
      ) => call<Page<AuditLogEntry>>('GET', `/audit-logs${qs(params)}`).then((r) => r.data),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Guest portal client (the guest app). Same transport; the guest cookie and the CSRF token
 * from the last stay response authenticate it.
 */
export function createGuestApiClient(options: ApiClientOptions = {}) {
  const { call } = createCaller(options);
  const data = <T>(r: { data: T }) => r.data;
  return {
    exchange: (token: string) => call<GuestStay>('POST', '/guest/session', { token }).then(data),
    logout: () => call<void>('DELETE', '/guest/session').then(data),
    stay: () => call<GuestStay>('GET', '/guest/stay').then(data),
    requestCode: () => call<void>('POST', '/guest/verification').then(data),
    verifyCode: (code: string) =>
      call<GuestStay>('POST', '/guest/verification/confirm', { code }).then(data),
    preCheckIn: (body: PreCheckInRequest) =>
      call<GuestStay>('PUT', '/guest/pre-check-in', body).then(data),
    selfCheckIn: () => call<SelfCheckInResult>('POST', '/guest/check-in').then(data),
    bill: () => call<GuestBill>('GET', '/guest/bill').then(data),
    serviceRequests: () =>
      call<{ items: ServiceRequest[] }>('GET', '/guest/service-requests').then((r) => r.data.items),
    createServiceRequest: (body: GuestServiceRequestCreate) =>
      call<ServiceRequest>('POST', '/guest/service-requests', body).then(data),
    rate: (requestId: string, rating: number, feedback = '') =>
      call<ServiceRequest>(
        'PUT',
        `/guest/service-requests/${encodeURIComponent(requestId)}/rating`,
        {
          rating,
          feedback,
        },
      ).then(data),
  };
}

export type GuestApiClient = ReturnType<typeof createGuestApiClient>;
