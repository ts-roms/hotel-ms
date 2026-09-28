import { PHOTO_RETENTION_DEFAULT_DAYS } from '@hotel/contracts';
import type { Tx } from '@hotel/database';

export const PHOTO_RETENTION_KEY = 'attendancePhotos';

/** Days punch selfies are kept in an organization (ADR-0022); 90 unless HR set it. */
export async function photoRetentionDaysInTx(tx: Tx, organizationId: string): Promise<number> {
  const row = await tx.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: PHOTO_RETENTION_KEY } },
  });
  const days = (row?.value as { days?: unknown } | undefined)?.days;
  return typeof days === 'number' ? days : PHOTO_RETENTION_DEFAULT_DAYS;
}
