import type { PaymentSettings } from '@hotel/contracts';
import type { Tx } from '@hotel/database';

export const PAYMENT_SETTINGS_KEY = 'payments';

const DEFAULT_SETTINGS: PaymentSettings = { selfCheckInHoldMinor: 0 };

/** The property's payment settings (property_settings key "payments"). */
export async function paymentSettingsInTx(tx: Tx, propertyId: string): Promise<PaymentSettings> {
  const row = await tx.propertySetting.findFirst({
    where: { propertyId, key: PAYMENT_SETTINGS_KEY },
  });
  const value = (row?.value ?? {}) as Partial<PaymentSettings>;
  return {
    selfCheckInHoldMinor:
      typeof value.selfCheckInHoldMinor === 'number'
        ? value.selfCheckInHoldMinor
        : DEFAULT_SETTINGS.selfCheckInHoldMinor,
  };
}

/**
 * Card hold needed before a guest checks themselves in: the property's configured amount
 * (0 = none), and whether an authorized hold of at least that amount is in place.
 */
export async function cardHoldStateInTx(
  tx: Tx,
  propertyId: string,
  reservationRoomId: string,
): Promise<{ requiredMinor: bigint; authorized: boolean }> {
  const { selfCheckInHoldMinor } = await paymentSettingsInTx(tx, propertyId);
  const requiredMinor = BigInt(selfCheckInHoldMinor);
  if (requiredMinor === 0n) return { requiredMinor, authorized: true };
  const hold = await tx.paymentIntent.findFirst({
    where: {
      reservationRoomId,
      kind: 'HOLD',
      status: 'AUTHORIZED',
      amountMinor: { gte: requiredMinor },
    },
    select: { id: true },
  });
  return { requiredMinor, authorized: hold !== null };
}
