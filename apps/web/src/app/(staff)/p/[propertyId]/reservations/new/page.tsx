'use client';

import { BOOKING_SOURCES } from '@hotel/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { addDays, formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useProperty, useRoutePropertyId } from '@/lib/property';

export default function NewReservationPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const router = useRouter();
  const property = useProperty(propertyId);
  const roomTypes = useQuery({ queryKey: ['room-types', propertyId], queryFn: pms.roomTypes });
  const ratePlans = useQuery({ queryKey: ['rate-plans', propertyId], queryFn: pms.ratePlans });

  // One key per form: a double click or network retry replays instead of double-booking.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    roomTypeId: '',
    ratePlanId: '',
    arrivalDate: '',
    departureDate: '',
    adults: 2,
    children: 0,
    source: 'PHONE' as (typeof BOOKING_SOURCES)[number],
    specialRequests: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    const businessDate = property.data?.currentBusinessDate;
    if (businessDate && !form.arrivalDate) {
      setForm((f) => ({
        ...f,
        arrivalDate: businessDate,
        departureDate: addDays(businessDate, 1),
      }));
    }
  }, [property.data, form.arrivalDate]);
  useEffect(() => {
    if (!form.roomTypeId && roomTypes.data?.[0]) set('roomTypeId', roomTypes.data[0].id);
    if (!form.ratePlanId && ratePlans.data?.[0]) set('ratePlanId', ratePlans.data[0].id);
  }, [roomTypes.data, ratePlans.data, form.roomTypeId, form.ratePlanId]);

  const canQuote =
    form.roomTypeId && form.ratePlanId && form.arrivalDate && form.departureDate > form.arrivalDate;
  const quote = useQuery({
    queryKey: [
      'quote',
      propertyId,
      form.roomTypeId,
      form.ratePlanId,
      form.arrivalDate,
      form.departureDate,
    ],
    queryFn: () =>
      pms.quote({
        roomTypeId: form.roomTypeId,
        ratePlanId: form.ratePlanId,
        arrivalDate: form.arrivalDate,
        departureDate: form.departureDate,
      }),
    enabled: !!canQuote,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () =>
      pms.createReservation(
        {
          source: form.source,
          externalRef: null,
          specialRequests: form.specialRequests,
          notes: '',
          booker: {
            newGuest: {
              firstName: form.firstName,
              lastName: form.lastName,
              email: form.email || null,
              phone: form.phone || null,
              countryCode: null,
              notes: '',
            },
          },
          rooms: [
            {
              roomTypeId: form.roomTypeId,
              ratePlanId: form.ratePlanId,
              arrivalDate: form.arrivalDate,
              departureDate: form.departureDate,
              adults: form.adults,
              children: form.children,
            },
          ],
        },
        idempotencyKey,
      ),
    onSuccess: (reservation) => router.replace(`/p/${propertyId}/reservations/${reservation.id}`),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t('res.new')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          {create.error && <Alert className="sm:col-span-2">{errorMessage(create.error)}</Alert>}
          <Field label={t('res.firstName')} id="firstName">
            <Input
              id="firstName"
              required
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
            />
          </Field>
          <Field label={t('res.lastName')} id="lastName">
            <Input
              id="lastName"
              required
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
            />
          </Field>
          <Field label={t('login.email')} id="email">
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label={t('res.phone')} id="phone">
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label={t('res.arrival')} id="arrival">
            <Input
              id="arrival"
              type="date"
              required
              min={property.data?.currentBusinessDate}
              value={form.arrivalDate}
              onChange={(e) => set('arrivalDate', e.target.value)}
            />
          </Field>
          <Field label={t('res.departure')} id="departure">
            <Input
              id="departure"
              type="date"
              required
              min={form.arrivalDate ? addDays(form.arrivalDate, 1) : undefined}
              value={form.departureDate}
              onChange={(e) => set('departureDate', e.target.value)}
            />
          </Field>
          <Field label={t('res.roomType')} id="roomType">
            <Select
              id="roomType"
              value={form.roomTypeId}
              onChange={(e) => set('roomTypeId', e.target.value)}
            >
              {roomTypes.data
                ?.filter((rt) => !rt.archived)
                .map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name} (max {rt.maxOccupancy})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('res.ratePlan')} id="ratePlan">
            <Select
              id="ratePlan"
              value={form.ratePlanId}
              onChange={(e) => set('ratePlanId', e.target.value)}
            >
              {ratePlans.data
                ?.filter((p) => !p.archived)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('res.adults')} id="adults">
            <Input
              id="adults"
              type="number"
              min={1}
              max={20}
              value={form.adults}
              onChange={(e) => set('adults', Number(e.target.value))}
            />
          </Field>
          <Field label={t('res.children')} id="children">
            <Input
              id="children"
              type="number"
              min={0}
              max={20}
              value={form.children}
              onChange={(e) => set('children', Number(e.target.value))}
            />
          </Field>
          <Field label={t('res.source')} id="source">
            <Select
              id="source"
              value={form.source}
              onChange={(e) => set('source', e.target.value as typeof form.source)}
            >
              {BOOKING_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('res.specialRequests')} id="requests">
            <Input
              id="requests"
              value={form.specialRequests}
              onChange={(e) => set('specialRequests', e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
            <span className="text-sm">
              {t('res.quote')}:{' '}
              {quote.data ? (
                <strong>
                  {formatMoney(quote.data.totalMinor, quote.data.currency)} (
                  {quote.data.nights.length} {t('res.nights')})
                </strong>
              ) : quote.error ? (
                errorMessage(quote.error)
              ) : (
                '—'
              )}
            </span>
            <Button type="submit" disabled={create.isPending || !quote.data}>
              {create.isPending ? t('res.creating') : t('res.create')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
