'use client';

import { BOOKING_SOURCES } from '@hotel/contracts';
import { addDays, formatMoney } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DocumentTitle,
  FormField,
  Input,
  NativeSelect,
  Skeleton,
  Spinner,
} from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useProperty, usePropertyId } from '@/lib/property';
import { enumLabel } from '@/lib/status';

export default function NewReservationPage() {
  const propertyId = usePropertyId();
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
    <div className="flex max-w-2xl flex-col gap-4">
      <Link
        href={`/p/${propertyId}/reservations`}
        className="group flex items-center gap-1 self-start text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-1" />
        {t('common.back')}
      </Link>
      <Card>
        <CardHeader>
          <DocumentTitle title={t('res.new')} />
          <CardTitle className="text-xl">{t('res.new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            {create.error && <Alert className="sm:col-span-2">{errorMessage(create.error)}</Alert>}
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
            <FormField label={t('res.arrival')} htmlFor="arrival">
              <Input
                id="arrival"
                type="date"
                required
                min={property.data?.currentBusinessDate}
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
            <FormField label={t('res.roomType')} htmlFor="roomType" loading={roomTypes.isPending}>
              <NativeSelect
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
              </NativeSelect>
            </FormField>
            <FormField label={t('res.ratePlan')} htmlFor="ratePlan" loading={ratePlans.isPending}>
              <NativeSelect
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

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-4 sm:col-span-2">
              <div className="flex flex-col" aria-live="polite">
                <span className="text-xs text-muted-foreground">{t('res.quote')}</span>
                {quote.isFetching ? (
                  <span className="flex items-center gap-2 py-1">
                    <Spinner className="size-4 text-primary" />
                    <Skeleton className="h-6 w-28" />
                  </span>
                ) : quote.data ? (
                  <span key={quote.data.totalMinor} className="animate-fade-in">
                    <strong className="text-xl tabular-nums">
                      {formatMoney(quote.data.totalMinor, quote.data.currency)}
                    </strong>{' '}
                    <span className="text-sm text-muted-foreground">
                      · {t('res.nightsCount', { count: quote.data.nights.length })}
                    </span>
                  </span>
                ) : quote.error ? (
                  <span className="text-sm text-destructive">{errorMessage(quote.error)}</span>
                ) : (
                  <span className="text-xl text-muted-foreground">—</span>
                )}
              </div>
              <Button type="submit" size="lg" loading={create.isPending} disabled={!quote.data}>
                {create.isPending ? t('res.creating') : t('res.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
