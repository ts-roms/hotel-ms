'use client';

import { BOOKING_SOURCES, type RatePlan, type RoomType } from '@hotel/contracts';
import { addDays } from '@hotel/format';
import { FormField, Input, NativeSelect } from '@hotel/ui';
import { t } from '@/lib/i18n';
import { enumLabel } from '@/lib/status';
import { type ReservationFormValues, type SetReservationField } from './reservation-form';

/** Dates, room type, rate plan, occupancy, source and special requests of the stay. */
export function StayDetails({
  form,
  set,
  minArrivalDate,
  roomTypes,
  roomTypesLoading,
  ratePlans,
  ratePlansLoading,
}: {
  form: ReservationFormValues;
  set: SetReservationField;
  minArrivalDate: string | undefined;
  roomTypes: RoomType[] | undefined;
  roomTypesLoading: boolean;
  ratePlans: RatePlan[] | undefined;
  ratePlansLoading: boolean;
}) {
  return (
    <>
      <FormField label={t('res.arrival')} htmlFor="arrival">
        <Input
          id="arrival"
          type="date"
          required
          min={minArrivalDate}
          value={form.arrivalDate}
          onChange={(e) => set('arrivalDate', e.target.value)}
        />
      </FormField>
      <FormField label={t('res.departure')} htmlFor="departure">
        <Input
          id="departure"
          type="date"
          required
          min={form.arrivalDate ? addDays(form.arrivalDate, 1) : undefined}
          value={form.departureDate}
          onChange={(e) => set('departureDate', e.target.value)}
        />
      </FormField>
      <FormField label={t('res.roomType')} htmlFor="roomType" loading={roomTypesLoading}>
        <NativeSelect
          id="roomType"
          value={form.roomTypeId}
          onChange={(e) => set('roomTypeId', e.target.value)}
        >
          {roomTypes
            ?.filter((rt) => !rt.archived)
            .map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name} (max {rt.maxOccupancy})
              </option>
            ))}
        </NativeSelect>
      </FormField>
      <FormField label={t('res.ratePlan')} htmlFor="ratePlan" loading={ratePlansLoading}>
        <NativeSelect
          id="ratePlan"
          value={form.ratePlanId}
          onChange={(e) => set('ratePlanId', e.target.value)}
        >
          {ratePlans
            ?.filter((p) => !p.archived)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </NativeSelect>
      </FormField>
      <FormField label={t('res.adults')} htmlFor="adults">
        <Input
          id="adults"
          type="number"
          min={1}
          max={20}
          value={form.adults}
          onChange={(e) => set('adults', Number(e.target.value))}
        />
      </FormField>
      <FormField label={t('res.children')} htmlFor="children">
        <Input
          id="children"
          type="number"
          min={0}
          max={20}
          value={form.children}
          onChange={(e) => set('children', Number(e.target.value))}
        />
      </FormField>
      <FormField label={t('res.source')} htmlFor="source">
        <NativeSelect
          id="source"
          value={form.source}
          onChange={(e) => set('source', e.target.value as typeof form.source)}
        >
          {BOOKING_SOURCES.map((s) => (
            <option key={s} value={s}>
              {enumLabel('bookingSource', s)}
            </option>
          ))}
        </NativeSelect>
      </FormField>
      <FormField label={t('res.specialRequests')} htmlFor="requests">
        <Input
          id="requests"
          value={form.specialRequests}
          onChange={(e) => set('specialRequests', e.target.value)}
        />
      </FormField>
    </>
  );
}
