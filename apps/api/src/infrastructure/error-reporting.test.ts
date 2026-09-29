import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { ProblemFilter } from '../common/problem.filter.js';
import { Problems } from '../common/problem.js';
import { type ErrorContext, reportError, setErrorReporter } from './error-reporting.js';

function hostFor(): ArgumentsHost {
  const reply = {
    header: () => reply,
    status: () => reply,
    type: () => reply,
    send: () => reply,
  };
  const request = {
    id: 'req-1',
    method: 'POST',
    routeOptions: { url: '/api/v1/things/:id' },
    log: { error: () => undefined },
  };
  return {
    switchToHttp: () => ({ getResponse: () => reply, getRequest: () => request }),
  } as unknown as ArgumentsHost;
}

describe('error reporting', () => {
  let restore: ReturnType<typeof setErrorReporter> | undefined;
  afterEach(() => {
    if (restore) setErrorReporter(restore);
  });

  it('is a no-op until configured, and never throws', () => {
    expect(() => reportError(new Error('x'))).not.toThrow();
    restore = setErrorReporter(() => {
      throw new Error('reporter down');
    });
    expect(() => reportError(new Error('x'))).not.toThrow();
  });

  it('reports unexpected server errors with the request id and route, not client errors', () => {
    const seen: { error: unknown; context: ErrorContext }[] = [];
    restore = setErrorReporter((error, context) => seen.push({ error, context }));
    const filter = new ProblemFilter();

    filter.catch(Problems.notFound('Thing'), hostFor());
    filter.catch(Problems.validation([{ path: 'x', message: 'bad' }]), hostFor());
    expect(seen).toHaveLength(0);

    const boom = new Error('database exploded');
    filter.catch(boom, hostFor());
    expect(seen).toEqual([
      { error: boom, context: { requestId: 'req-1', route: 'POST /api/v1/things/:id' } },
    ]);
  });
});
