import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Problem } from '@hotel/contracts';
import { Prisma } from '@hotel/database';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProblemException } from '../common/problem.js';
import { reportError } from './error-reporting.js';

const PROBLEM_BASE = 'https://docs.hotel-platform.dev/problems/';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      request.log.error({ err: exception }, 'unhandled error');
      reportError(exception, {
        requestId: problem.requestId,
        route: `${request.method} ${request.routeOptions?.url ?? 'unknown'}`,
      });
    }

    const headers = exception instanceof ProblemException ? exception.headers : undefined;
    for (const [name, value] of Object.entries(headers ?? {})) reply.header(name, value);
    void reply.status(problem.status).type('application/problem+json').send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): Problem {
    const requestId = String(request.id);

    if (exception instanceof ProblemException) {
      return {
        type: PROBLEM_BASE + exception.code.toLowerCase().replaceAll('_', '-'),
        title: exception.title,
        status: exception.status,
        code: exception.code,
        ...(exception.detail ? { detail: exception.detail } : {}),
        ...(exception.errors ? { errors: exception.errors } : {}),
        requestId,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          type: PROBLEM_BASE + 'conflict',
          title: 'Conflict',
          status: 409,
          code: 'CONFLICT',
          detail: 'A record with the same unique value already exists.',
          requestId,
        };
      }
      if (exception.code === 'P2025') {
        return {
          type: PROBLEM_BASE + 'not-found',
          title: 'Not found',
          status: 404,
          code: 'NOT_FOUND',
          requestId,
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Framework-level errors (unknown route, bad JSON, payload too large).
      return {
        type: PROBLEM_BASE + (status === 404 ? 'not-found' : 'http-error'),
        title: exception.message,
        status,
        code: status === 404 ? 'NOT_FOUND' : status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR',
        requestId,
      };
    }

    // Fastify errors (e.g. malformed JSON body) carry a statusCode.
    const statusCode = (exception as { statusCode?: unknown })?.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return {
        type: PROBLEM_BASE + 'validation-failed',
        title: 'Malformed request',
        status: statusCode,
        code: 'VALIDATION_FAILED',
        requestId,
      };
    }

    // Never leak internals to the client; details are in the log under requestId.
    return {
      type: PROBLEM_BASE + 'internal-error',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      requestId,
    };
  }
}
