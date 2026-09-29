'use client';

import { FormField, Input } from '@hotel/ui';
import { t } from '@/lib/i18n';
import { type ReservationFormValues, type SetReservationField } from './reservation-form';

/** The booker's name and contact fields. */
export function GuestDetails({
  form,
  set,
}: {
  form: Pick<ReservationFormValues, 'firstName' | 'lastName' | 'email' | 'phone'>;
  set: SetReservationField;
}) {
  return (
    <>
      <FormField label={t('res.firstName')} htmlFor="firstName">
        <Input
          id="firstName"
          required
          value={form.firstName}
          onChange={(e) => set('firstName', e.target.value)}
        />
      </FormField>
      <FormField label={t('res.lastName')} htmlFor="lastName">
        <Input
          id="lastName"
          required
          value={form.lastName}
          onChange={(e) => set('lastName', e.target.value)}
        />
      </FormField>
      <FormField label={t('login.email')} htmlFor="email">
        <Input
          id="email"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </FormField>
      <FormField label={t('res.phone')} htmlFor="phone">
        <Input
          id="phone"
          type="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
        />
      </FormField>
    </>
  );
}
