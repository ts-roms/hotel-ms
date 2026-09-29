import type { Tx } from '@hotel/database';

/** Next value of a per-property counter; row-locked, so concurrent callers get distinct values. */
export async function nextNumber(
  tx: Tx,
  organizationId: string,
  propertyId: string,
  name: string,
): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ value: bigint }[]>`
    INSERT INTO number_sequences (organization_id, property_id, name, next_value)
    VALUES (${organizationId}::uuid, ${propertyId}::uuid, ${name}, 2)
    ON CONFLICT (property_id, name) DO UPDATE SET next_value = number_sequences.next_value + 1
    RETURNING next_value - 1 AS value`;
  return row!.value;
}
