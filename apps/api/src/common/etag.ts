import { Headers } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Problems } from './problem.js';

export const weakEtag = (version: number) => `W/"${version}"`;

/** Optimistic concurrency (ADR-0009): If-Match is required on updates of versioned aggregates. */
export function parseIfMatch(header: string | undefined): number {
  if (!header) throw Problems.preconditionRequired();
  const match = /^(?:W\/)?"(\d+)"$/.exec(header.trim());
  if (!match) throw Problems.versionConflict();
  return Number(match[1]);
}

/**
 * The If-Match request header, as a handler parameter (pass it to parseIfMatch). Also
 * declares the header as required in OpenAPI, so clients know to send the version.
 */
export function IfMatch(
  description = 'The version being changed, as its ETag (W/"<version>"); 412 when stale',
): ParameterDecorator {
  return (target, key, index) => {
    if (key === undefined) throw new Error('@IfMatch() is only supported on methods');
    Headers('if-match')(target, key, index);
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) throw new Error(`No descriptor for ${String(key)}`);
    ApiHeader({
      name: 'If-Match',
      required: true,
      description,
    })(target, key, descriptor);
  };
}
