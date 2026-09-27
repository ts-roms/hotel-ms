'use client';

import { ApiError } from '@hotel/api-client';
import {
  type GuestStay,
  type SelfCheckInResult,
  SERVICE_CATEGORIES,
  type ServiceRequest,
} from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Notice,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, errorMessage, formatDate, formatMoney, rememberStay } from '@/lib/api';
import { RoomService } from './room-service';

const CATEGORY_LABELS: Record<(typeof SERVICE_CATEGORIES)[number], string> = {
  TOWELS: 'Towels',
  TOILETRIES: 'Toiletries',
  PILLOWS_BLANKETS: 'Pillows & blankets',
  CLEANING: 'Room cleaning',
  MAINTENANCE: 'Something is broken',
  LAUNDRY: 'Laundry',
  TRANSPORT: 'Transport',
  LUGGAGE: 'Luggage help',
  WAKE_UP_CALL: 'Wake-up call',
  OTHER: 'Something else',
};

const STATUS_LABELS: Record<ServiceRequest['status'], string> = {
  OPEN: 'Sent',
  ACKNOWLEDGED: 'Seen by staff',
  IN_PROGRESS: 'On its way',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

function useStay() {
  return useQuery({
    queryKey: ['stay'],
    queryFn: () => api.stay().then(rememberStay),
    retry: false,
  });
}

export default function StayPage() {
  const stay = useStay();
  // Kept here: after check-in the stay refreshes and the check-in card goes away, but the
  // key instructions must stay on screen.
  const [checkedIn, setCheckedIn] = useState<SelfCheckInResult | null>(null);

  if (stay.isPending) {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading your stay…</p>
      </Shell>
    );
  }
  if (stay.isError || !stay.data) {
    // No data and no error: signed out on this device just now.
    const signedOut = !stay.error || (stay.error instanceof ApiError && stay.error.status === 401);
    return (
      <Shell>
        <Alert>
          {signedOut
            ? 'Your session has ended. Open the link from your booking email again.'
            : errorMessage(stay.error)}
        </Alert>
      </Shell>
    );
  }
  const s = stay.data;
  return (
    <Shell>
      <Overview stay={s} />
      {!s.verified && <Verification stay={s} />}
      {s.stay.status === 'RESERVED' && <PreCheckIn stay={s} />}
      {checkedIn && <RoomAccess result={checkedIn} />}
      {s.selfCheckInAvailable && !checkedIn && <SelfCheckIn stay={s} onCheckedIn={setCheckedIn} />}
      {s.verified && s.stay.status === 'IN_HOUSE' && <RoomService />}
      {s.verified && s.stay.status === 'IN_HOUSE' && <Requests />}
      {s.verified && (s.stay.status === 'IN_HOUSE' || s.stay.status === 'CHECKED_OUT') && <Bill />}
      <Contact stay={s} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-4 pb-12">{children}</main>;
}

function Overview({ stay: s }: { stay: GuestStay }) {
  const statusLabel = {
    RESERVED: 'Confirmed',
    IN_HOUSE: 'Checked in',
    CHECKED_OUT: 'Checked out',
    CANCELLED: 'Cancelled',
    NO_SHOW: 'No-show',
  }[s.stay.status];
  return (
    <Card>
      <CardHeader>
        <CardDescription>{s.property.name}</CardDescription>
        <CardTitle>Hello, {s.guest.firstName}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Booking {s.confirmationNo}</span>
          <Badge>{statusLabel}</Badge>
        </div>
        <div>
          {formatDate(s.stay.arrivalDate)} → {formatDate(s.stay.departureDate)}
        </div>
        <div>
          {s.stay.roomTypeName} · {s.stay.adults} adult{s.stay.adults === 1 ? '' : 's'}
          {s.stay.children > 0 &&
            ` · ${s.stay.children} child${s.stay.children === 1 ? '' : 'ren'}`}
        </div>
        {s.stay.roomNumber && <div className="text-lg font-semibold">Room {s.stay.roomNumber}</div>}
        <div className="text-muted-foreground">
          Check-in from {s.property.checkInTime} · check-out by {s.property.checkOutTime}
        </div>
      </CardContent>
    </Card>
  );
}

function Verification({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const send = useMutation({ mutationFn: api.requestCode });
  const verify = useMutation({
    mutationFn: (value: string) => api.verifyCode(value),
    onSuccess: (stay) => queryClient.setQueryData(['stay'], rememberStay(stay)),
  });
  if (!s.verificationDestination) {
    return (
      <Notice>
        We have no email address for this booking, so online check-in and requests are not
        available. The front desk will be happy to help.
      </Notice>
    );
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate(code.trim());
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Confirm it is you</CardTitle>
        <CardDescription>
          To check in online, see your bill or send requests, enter the code we email to{' '}
          {s.verificationDestination}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(send.error || verify.error) && <Alert>{errorMessage(send.error ?? verify.error)}</Alert>}
        {!send.isSuccess ? (
          <Button onClick={() => send.mutate()} disabled={send.isPending}>
            Email me a code
          </Button>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
            <Label htmlFor="code">6-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" disabled={verify.isPending || code.trim().length !== 6}>
              Confirm
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() => send.mutate()}
            >
              Send a new code
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PreCheckIn({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const [arrival, setArrival] = useState(s.stay.expectedArrivalTime ?? s.property.checkInTime);
  const [phone, setPhone] = useState('');
  const [requests, setRequests] = useState('');
  const [editing, setEditing] = useState(!s.stay.preCheckInCompleted);
  const save = useMutation({
    mutationFn: () =>
      api.preCheckIn({
        expectedArrivalTime: arrival,
        phone: phone.trim() || null,
        specialRequests: requests.trim(),
      }),
    onSuccess: (stay) => {
      queryClient.setQueryData(['stay'], rememberStay(stay));
      setEditing(false);
    },
  });
  if (!editing) {
    return (
      <Notice>
        Thanks! We expect you around {s.stay.expectedArrivalTime}.{' '}
        <button type="button" className="underline" onClick={() => setEditing(true)}>
          Change
        </button>
      </Notice>
    );
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Before you arrive</CardTitle>
        <CardDescription>Help us prepare for your arrival.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          <Label htmlFor="arrival">Expected arrival time</Label>
          <Input
            id="arrival"
            type="time"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
          />
          <Label htmlFor="phone">Mobile number (optional)</Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Label htmlFor="requests">Special requests (optional)</Label>
          <textarea
            id="requests"
            className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
            maxLength={1000}
            value={requests}
            onChange={(e) => setRequests(e.target.value)}
          />
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RoomAccess({ result }: { result: SelfCheckInResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">You are checked in to room {result.roomNumber}</CardTitle>
      </CardHeader>
      <CardContent>
        <Notice>{result.access.instructions}</Notice>
      </CardContent>
    </Card>
  );
}

function SelfCheckIn({
  stay: s,
  onCheckedIn,
}: {
  stay: GuestStay;
  onCheckedIn: (result: SelfCheckInResult) => void;
}) {
  const queryClient = useQueryClient();
  const checkIn = useMutation({
    mutationFn: api.selfCheckIn,
    onSuccess: (result) => {
      onCheckedIn(result);
      return queryClient.invalidateQueries({ queryKey: ['stay'] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Check in online</CardTitle>
        <CardDescription>
          {s.verified
            ? 'Skip the queue: we assign your room now and tell you how to get your key.'
            : 'Confirm it is you first (above) to check in online.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {checkIn.error && <Alert>{errorMessage(checkIn.error)}</Alert>}
        <Button onClick={() => checkIn.mutate()} disabled={!s.verified || checkIn.isPending}>
          Check in now
        </Button>
      </CardContent>
    </Card>
  );
}

function Requests() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<(typeof SERVICE_CATEGORIES)[number]>('TOWELS');
  const [description, setDescription] = useState('');
  const list = useQuery({ queryKey: ['requests'], queryFn: api.serviceRequests });
  const create = useMutation({
    mutationFn: () => api.createServiceRequest({ category, description: description.trim() }),
    onSuccess: () => {
      setDescription('');
      return queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });
  const rate = useMutation({
    mutationFn: (input: { id: string; rating: number }) => api.rate(input.id, input.rating),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests'] }),
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Need anything?</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {create.error && <Alert>{errorMessage(create.error)}</Alert>}
          <Label htmlFor="category">Request</Label>
          <Select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
          >
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
          <Label htmlFor="details">Details (optional)</Label>
          <Input
            id="details"
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" disabled={create.isPending}>
            Send request
          </Button>
        </form>
        {rate.error && <Alert>{errorMessage(rate.error)}</Alert>}
        <ul className="flex flex-col gap-2">
          {list.data?.map((r) => (
            <li key={r.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{CATEGORY_LABELS[r.category]}</span>
                <Badge>{STATUS_LABELS[r.status]}</Badge>
              </div>
              {r.description && <p className="text-muted-foreground">{r.description}</p>}
              {r.status === 'DONE' &&
                (r.rating ? (
                  <p className="mt-1 text-muted-foreground">
                    You rated this {r.rating}/5. Thank you!
                  </p>
                ) : (
                  <div className="mt-2 flex items-center gap-1" aria-label="Rate this request">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="rounded border px-2 py-1"
                        aria-label={`${n} out of 5`}
                        disabled={rate.isPending}
                        onClick={() => rate.mutate({ id: r.id, rating: n })}
                      >
                        {'★'.repeat(n)}
                      </button>
                    ))}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Bill() {
  const bill = useQuery({ queryKey: ['bill'], queryFn: api.bill });
  if (!bill.data) return null;
  const { currency, lines, balanceMinor } = bill.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your bill</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {lines.length === 0 && <p className="text-muted-foreground">No charges yet.</p>}
        {lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span>
              <span className="text-muted-foreground">{formatDate(l.date)}</span> {l.description}
            </span>
            <span className="tabular-nums">{formatMoney(l.amountMinor, currency)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 font-semibold">
          <span>Balance</span>
          <span className="tabular-nums">{formatMoney(balanceMinor, currency)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Contact({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.setQueryData(['stay'], undefined),
  });
  return (
    <div className="flex flex-col gap-1 text-center text-sm text-muted-foreground">
      <span>
        {s.property.name}
        {s.property.city && `, ${s.property.city}`}
      </span>
      {s.property.phone && <a href={`tel:${s.property.phone}`}>{s.property.phone}</a>}
      {s.property.email && <a href={`mailto:${s.property.email}`}>{s.property.email}</a>}
      <button type="button" className="mt-2 underline" onClick={() => logout.mutate()}>
        Sign out on this device
      </button>
      {logout.isSuccess && <span>Signed out. Your email link still works to sign back in.</span>}
    </div>
  );
}
