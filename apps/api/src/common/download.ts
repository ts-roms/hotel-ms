import type { FastifyReply } from 'fastify';

/**
 * RFC 6266 Content-Disposition for a download: an ASCII fallback name (other characters,
 * quotes and backslashes become "_") plus the exact name as UTF-8 in `filename*`.
 */
export function attachmentHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Marks the reply as a file download that is never cached: content type, attachment name
 * and `cache-control: no-store`. Returns the reply for chaining.
 */
export function asDownload(reply: FastifyReply, fileName: string, contentType: string) {
  return reply
    .header('content-type', contentType)
    .header('content-disposition', attachmentHeader(fileName))
    .header('cache-control', 'no-store');
}

/** A CSV download (UTF-8); returns the CSV text for a passthrough handler to send. */
export function sendCsv(reply: FastifyReply, fileName: string, csv: string): string {
  asDownload(reply, fileName, 'text/csv; charset=utf-8');
  return csv;
}

/** A JSON download (e.g. a data export), pretty-printed. */
export async function sendJsonDownload(
  reply: FastifyReply,
  fileName: string,
  data: unknown,
): Promise<void> {
  await asDownload(reply, fileName, 'application/json; charset=utf-8').send(
    JSON.stringify(data, null, 2),
  );
}
