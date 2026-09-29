import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import type { LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { FastifyBaseLogger, FastifyServerOptions } from 'fastify';
import {
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_TYPES,
  IMPORT_MAX_BYTES,
} from '@hotel/contracts';
import { ClsService } from 'nestjs-cls';
import { declarePathParameters, orderOperations } from './api-surface.js';
import { AppModule } from './app.module.js';
import type { RequestContext } from './common/request-context.js';
import type { Env } from './config/env.js';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'test') return false;
  return {
    level: env.LOG_LEVEL,
    // Never log secrets or credentials (blueprint §20.4). Headers are not logged at all
    // by the default serializers; these paths cover explicit logging mistakes.
    redact: {
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {}),
  };
}

class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: FastifyBaseLogger) {}
  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}

export async function createApp(env: Env): Promise<NestFastifyApplication> {
  const options: FastifyServerOptions = {
    logger: loggerOptions(env),
    // Trust exactly N proxy hops (load balancer, Next.js proxy) for req.ip.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: 1024 * 1024,
    requestIdHeader: false,
    // Accept a caller's X-Request-Id only if it looks sane; otherwise mint one.
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    },
  };
  const adapter = new FastifyAdapter(options as ConstructorParameters<typeof FastifyAdapter>[0]);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    bufferLogs: true,
    // Webhook signatures are computed over the exact bytes received.
    rawBody: true,
  });
  const fastify = app.getHttpAdapter().getInstance();
  app.useLogger(new PinoNestLogger(fastify.log));
  // File uploads (employee documents, ADR-0019): the body is the file, up to its own limit.
  fastify.addContentTypeParser(
    [...EMPLOYEE_DOCUMENT_TYPES],
    { parseAs: 'buffer', bodyLimit: EMPLOYEE_DOCUMENT_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );
  // CSV imports (ADR-0030): the body is the file, read as text.
  fastify.addContentTypeParser(
    ['text/csv'],
    { parseAs: 'string', bodyLimit: IMPORT_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  const cls = app.get<ClsService<RequestContext>>(ClsService);
  fastify.addHook('onRequest', (req, reply, done) => {
    void reply.header('x-request-id', req.id);
    cls.run(() => {
      cls.set('requestId', String(req.id));
      cls.set('ip', req.ip ?? null);
      cls.set('userAgent', req.headers['user-agent'] ?? null);
      cls.set('log', req.log);
      done();
    });
  });

  await app.register(fastifyCookie);
  await app.register(helmet, {
    // JSON API: no HTML is served except the dev-only docs page.
    contentSecurityPolicy: env.OPENAPI_ENABLED
      ? false
      : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  app.enableCors({
    origin: [...env.WEB_ORIGIN, env.GUEST_ORIGIN],
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id', 'if-match', 'idempotency-key'],
    exposedHeaders: ['etag', 'x-request-id', 'retry-after'],
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.enableShutdownHooks();

  if (env.OPENAPI_ENABLED) {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
  }
  return app;
}

export function buildOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Hotel Platform API')
    .setDescription(
      'Multi-tenant hotel management platform. Errors use application/problem+json (RFC 9457).',
    )
    .setVersion('v1')
    .addCookieAuth('hotel_sid')
    .build();
  return orderOperations(declarePathParameters(SwaggerModule.createDocument(app, config)));
}
