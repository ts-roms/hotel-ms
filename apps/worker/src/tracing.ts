/**
 * OpenTelemetry tracing (ADR-0029), loaded before the app with
 * `node --import ./dist/tracing.js dist/main.js`. Off unless OTEL_EXPORTER_OTLP_ENDPOINT is
 * set (in AWS: the collector sidecar, which forwards to X-Ray). Configuration is the
 * standard OTEL_* environment; the defaults below pick the instrumentations this service
 * uses. Log lines carry trace_id/span_id (pino instrumentation) to join logs and traces.
 */
import { register } from 'node:module';

const enabled =
  !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true';

if (enabled) {
  process.env.OTEL_SERVICE_NAME ??= 'hotel-worker';
  process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS ??= 'http,undici,pg,ioredis,pino,aws-sdk';
  process.env.OTEL_TRACES_SAMPLER ??= 'parentbased_traceidratio';
  process.env.OTEL_TRACES_SAMPLER_ARG ??= '0.1';
  process.env.OTEL_METRICS_EXPORTER ??= 'none';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
  // ES modules are instrumented through the import-in-the-middle loader hook.
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  await import('@opentelemetry/auto-instrumentations-node/register');
}
