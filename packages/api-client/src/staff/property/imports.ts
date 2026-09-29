import type { ImportKind, ImportPreview, ImportResult } from '@hotel/contracts';
import * as op from '../../generated/operations.js';
import { data, type PropertyTransport, type RouteSegment } from '../../http.js';

/**
 * The API has one route pair per import kind (ImportsController_preview<Kind>, _commit<Kind>);
 * the kind is the path segment. A kind without both routes fails to type-check.
 */
type Routed = RouteSegment<'POST /properties/{propertyId}/imports/', '/preview'> &
  RouteSegment<'POST /properties/{propertyId}/imports/', '/commit'>;

/** CSV import (ADR-0030): the file's text, previewed, then committed by token. */
export function importsClient({ call, propertyId }: PropertyTransport) {
  const base = op.paths.PropertiesController_get({ propertyId });
  const route = (kind: Routed, action: 'preview' | 'commit') => `${base}/imports/${kind}/${action}`;
  return {
    importPreview: (kind: ImportKind, csvText: string) =>
      call<ImportPreview>(
        'POST',
        route(kind, 'preview'),
        new Blob([csvText], { type: 'text/csv' }),
      ).then(data),
    importCommit: (kind: ImportKind, token: string) =>
      call<ImportResult>('POST', route(kind, 'commit'), { token }).then(data),
  };
}
