'use client';

import { addDays } from '@hotel/format';
import { Alert, Card, CardContent, CardHeader, CardTitle, DocumentTitle } from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useProperty, usePropertyId } from '@/lib/property';
import { GuestDetails } from './_components/guest-details';
import { QuoteSummary } from './_components/quote-summary';
import { type ReservationFormValues } from './_components/reservation-form';
import { StayDetails } from './_components/stay-details';

export default function NewReservationPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const router = useRouter();
  const property = useProperty(propertyId);
  const roomTypes = useQuery({ queryKey: ['room-types', propertyId], queryFn: pms.roomTypes });
  const ratePlans = useQuery({ queryKey: ['rate-plans', propertyId], queryFn: pms.ratePlans });

  // One key per form: a double click or network retry replays instead of double-booking.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const [form, setForm] = useState<ReservationFormValues>({
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
    source: 'PHONE',
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
            <GuestDetails form={form} set={set} />
            <StayDetails
              form={form}
              set={set}
              minArrivalDate={property.data?.currentBusinessDate}
              roomTypes={roomTypes.data}
              roomTypesLoading={roomTypes.isPending}
              ratePlans={ratePlans.data}
              ratePlansLoading={ratePlans.isPending}
            />
            <QuoteSummary quote={quote} creating={create.isPending} />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
