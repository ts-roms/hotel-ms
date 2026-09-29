import { describe, expect, it, vi } from 'vitest';
import * as op from './generated/operations.js';
import type { Call } from './http.js';

/** A `call` that records its arguments. */
function recordingCall() {
  const call = vi.fn(async () => ({ data: undefined, etag: null }));
  return { call: call as unknown as Call, args: () => call.mock.calls[0] as unknown[] };
}

describe('generated operations', () => {
  it('fill and URL-encode path parameters, including ones the document leaves undeclared', () => {
    expect(op.paths.FolioController_postCharge({ propertyId: 'p/1', folioId: 'f 1' })).toBe(
      '/properties/p%2F1/folios/f%201/charges',
    );
  });

  it('append the query in the order given, without undefined values', () => {
    expect(
      op.paths.PropertyHrController_payrollExport({ propertyId: 'p1' }, { from: 'a', to: 'b' }),
    ).toBe('/properties/p1/payroll-export?from=a&to=b');
    expect(op.paths.AuditController_list({ cursor: undefined })).toBe('/audit-logs');
  });

  it('send the method, body and declared headers under their wire names', async () => {
    const { call, args } = recordingCall();
    await op.FolioController_postCharge(
      call,
      { propertyId: 'p1', folioId: 'f1' },
      { a: 1 },
      {
        idempotencyKey: 'k1',
      },
    );
    expect(args()).toEqual([
      'POST',
      '/properties/p1/folios/f1/charges',
      { a: 1 },
      { 'idempotency-key': 'k1' },
    ]);
  });

  it('send If-Match on operations that read it, with no body when there is none', async () => {
    const { call, args } = recordingCall();
    await op.PropertyHrController_cancelShift(
      call,
      { propertyId: 'p1', shiftId: 's1' },
      { ifMatch: 'W/"2"' },
    );
    expect(args()).toEqual([
      'POST',
      '/properties/p1/shifts/s1/cancel',
      undefined,
      { 'if-match': 'W/"2"' },
    ]);
  });

  it('send a binary body as given', async () => {
    const { call, args } = recordingCall();
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    await op.KioskController_clock(call, { employeeNo: 'E1', type: 'IN' }, photo);
    expect(args()).toEqual(['POST', '/kiosk/clock?employeeNo=E1&type=IN', photo]);
  });
});
