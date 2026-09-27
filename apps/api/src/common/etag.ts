import { Problems } from './problem.js';

export const weakEtag = (version: number) => `W/"${version}"`;

/** Optimistic concurrency (ADR-0009): If-Match is required on updates of versioned aggregates. */
export function parseIfMatch(header: string | undefined): number {
  if (!header) throw Problems.preconditionRequired();
  const match = /^(?:W\/)?"(\d+)"$/.exec(header.trim());
  if (!match) throw Problems.versionConflict();
  return Number(match[1]);
}
