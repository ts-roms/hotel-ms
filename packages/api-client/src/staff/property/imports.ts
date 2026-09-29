import type { ImportKind, ImportPreview, ImportResult } from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** CSV import (ADR-0030): the file's text, previewed, then committed by token. */
export function importsClient({ call, p }: PropertyTransport) {
  return {
    importPreview: (kind: ImportKind, csvText: string) =>
      call<ImportPreview>(
        'POST',
        `${p}/imports/${kind}/preview`,
        new Blob([csvText], { type: 'text/csv' }),
      ).then((r) => r.data),
    importCommit: (kind: ImportKind, token: string) =>
      call<ImportResult>('POST', `${p}/imports/${kind}/commit`, { token }).then((r) => r.data),
  };
}
