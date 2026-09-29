'use client';

import { ApiError } from '@hotel/api-client';
import {
  type GuestStay,
  type SelfCheckInResult,
  SERVICE_CATEGORIES,
  type ServiceRequest,
} from '@hotel/contracts';
import { formatDate, formatMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  type BadgeVariant,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  LoadingRegion,
  Notice,
  NativeSelect,
  Skeleton,
  SkeletonCard,
  Textarea,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BedDouble,
  BellRing,
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  DoorOpen,
  KeyRound,
  LogOut,
  MapPin,
  PartyPopper,
  Mail,
  Phone,
  Receipt,
  Send,
  ShieldCheck,
  Star,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { BrandMark } from '@/components/guest-shell';
import { Section } from '@/components/section';
import { api, errorMessage, rememberStay } from '@/lib/api';
import { CheckoutRequest, HotelInfo, IdUpload, Notifications } from './extras';
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
  CHECKOUT: 'Checkout',
};

/** What the request form offers; checkout has its own card. */
const REQUEST_CATEGORIES = SERVICE_CATEGORIES.filter(
  (c): c is Exclude<(typeof SERVICE_CATEGORIES)[number], 'CHECKOUT'> => c !== 'CHECKOUT',
);

const STATUS_LABELS: Record<ServiceRequest['status'], [string, BadgeVariant]> = {
  OPEN: ['Sent', 'info'],
  ACKNOWLEDGED: ['Seen by staff', 'primary'],
  IN_PROGRESS: ['On its way', 'warning'],
  DONE: ['Done', 'success'],
  CANCELLED: ['Cancelled', 'danger'],
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
        <StaySkeleton />
      </Shell>
    );
  }
  if (stay.isError || !stay.data) {
    // No data and no error: signed out on this device just now.
    const signedOut = !stay.error || (stay.error instanceof ApiError && stay.error.status === 401);
    return (
      <Shell>
        <div className="flex flex-col items-center gap-6 pt-16">
          <BrandMark />
          <Alert className="w-full">
            {signedOut
              ? 'Your session has ended. Open the link from your booking email again.'
              : errorMessage(stay.error)}
          </Alert>
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>
            How do I get my link?
          </Link>
        </div>
      </Shell>
    );
  }
  const s = stay.data;
  return (
    <Shell>
      <div className="stagger flex flex-col gap-4">
        <Overview stay={s} />
        {s.verified && <Notifications unread={s.unreadNotifications} />}
        {!s.verified && <Verification stay={s} />}
        {s.verified && (s.stay.status === 'RESERVED' || s.stay.status === 'IN_HOUSE') && (
          <IdUpload stay={s} />
        )}
        {s.verified && s.stay.status === 'RESERVED' && <PreCheckIn stay={s} />}
        {checkedIn && <RoomAccess result={checkedIn} />}
        {s.selfCheckInAvailable && !checkedIn && (
          <SelfCheckIn stay={s} onCheckedIn={setCheckedIn} />
        )}
        {s.verified && s.stay.status === 'IN_HOUSE' && <RoomService />}
        {s.verified && s.stay.status === 'IN_HOUSE' && <Requests />}
        {s.verified && (s.stay.status === 'IN_HOUSE' || s.stay.status === 'CHECKED_OUT') && (
          <Bill />
        )}
        {s.verified && s.stay.status === 'IN_HOUSE' && <CheckoutRequest stay={s} />}
        {(s.stay.status === 'RESERVED' || s.stay.status === 'IN_HOUSE') && (
          <HotelEvents timeZone={s.property.timezone} />
        )}
        <HotelInfo stay={s} />
        <Contact stay={s} />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex max-w-lg flex-col gap-4 p-4 pb-12">{children}</main>;
}

function StaySkeleton() {
  return (
    <LoadingRegion label="Loading your stay…" className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-muted p-6">
        <Skeleton className="h-3 w-32 bg-foreground/10" />
        <Skeleton className="h-7 w-48 bg-foreground/10" />
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Skeleton className="h-14 rounded-xl bg-foreground/10" />
          <Skeleton className="h-14 rounded-xl bg-foreground/10" />
        </div>
      </div>
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
    </LoadingRegion>
  );
}

const STAY_STATUS: Record<GuestStay['stay']['status'], string> = {
  RESERVED: 'Confirmed',
  IN_HOUSE: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

function Overview({ stay: s }: { stay: GuestStay }) {
  const guests = [
    `${s.stay.adults} adult${s.stay.adults === 1 ? '' : 's'}`,
    s.stay.children > 0 && `${s.stay.children} child${s.stay.children === 1 ? '' : 'ren'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="guest-hero relative overflow-hidden rounded-2xl p-6 shadow-xl shadow-primary/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm opacity-80">{s.property.name}</span>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {s.guest.firstName}</h1>
        </div>
        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur">
          {STAY_STATUS[s.stay.status]}
        </span>
      </div>

      {s.stay.roomNumber && (
        <div className="mt-5 flex items-center gap-3">
          <DoorOpen className="size-6 opacity-80" />
          <span className="text-3xl font-semibold tracking-tight">Room {s.stay.roomNumber}</span>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <HeroTile icon={<CalendarDays />} label="Check-in">
          {formatDate(s.stay.arrivalDate)}
          <span className="block text-xs opacity-75">from {s.property.checkInTime}</span>
        </HeroTile>
        <HeroTile icon={<CalendarDays />} label="Check-out">
          {formatDate(s.stay.departureDate)}
          <span className="block text-xs opacity-75">by {s.property.checkOutTime}</span>
        </HeroTile>
        <HeroTile icon={<BedDouble />} label="Room type">
          {s.stay.roomTypeName}
        </HeroTile>
        <HeroTile icon={<Users />} label="Guests">
          {guests}
        </HeroTile>
      </div>

      <p className="mt-4 font-mono text-xs opacity-75">Booking {s.confirmationNo}</p>
    </section>
  );
}

function HeroTile({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white/12 p-3 backdrop-blur">
      <span className="flex items-center gap-1.5 text-xs opacity-75 [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="mt-0.5 block font-medium">{children}</span>
    </div>
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
    <Section
      icon={<ShieldCheck />}
      title="Confirm it is you"
      description={
        <>
          To check in online, see your bill or send requests, enter the code we email to{' '}
          <strong className="text-foreground">{s.verificationDestination}</strong>.
        </>
      }
    >
      <CardContent className="flex flex-col gap-3">
        {(send.error || verify.error) && <Alert>{errorMessage(send.error ?? verify.error)}</Alert>}
        {!send.isSuccess ? (
          <Button size="lg" onClick={() => send.mutate()} loading={send.isPending}>
            {!send.isPending && <Mail />}
            Email me a code
          </Button>
        ) : (
          <form onSubmit={onSubmit} className="flex animate-fade-in flex-col gap-3" noValidate>
            <Label htmlFor="code">6-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              type="submit"
              size="lg"
              loading={verify.isPending}
              disabled={code.trim().length !== 6}
            >
              Confirm
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              Send a new code
            </Button>
          </form>
        )}
      </CardContent>
    </Section>
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
      <Card className="flex items-center gap-3 border-success/30 bg-success/5 p-4 text-sm">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="size-4" />
        </span>
        <span className="flex-1">
          Thanks! We expect you around <strong>{s.stay.expectedArrivalTime}</strong>.
        </span>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Change
        </Button>
      </Card>
    );
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <Section
      icon={<Clock />}
      title="Before you arrive"
      description="Help us prepare for your arrival."
    >
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="arrival">Expected arrival time</Label>
            <Input
              id="arrival"
              type="time"
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="phone">Mobile number (optional)</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="requests">Special requests (optional)</Label>
            <Textarea
              id="requests"
              maxLength={1000}
              value={requests}
              onChange={(e) => setRequests(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" loading={save.isPending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Section>
  );
}

function RoomAccess({ result }: { result: SelfCheckInResult }) {
  return (
    <Card className="animate-scale-in border-success/30 bg-success/5">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-base">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="size-4" />
          </span>
          You are checked in to room {result.roomNumber}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 rounded-xl border bg-card p-4 text-sm">
          <KeyRound className="size-5 shrink-0 text-primary" />
          <p>{result.access.instructions}</p>
        </div>
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
  // Back from the card provider: ?hold=<intent id>. Wait for its confirmation.
  const [returned] = useState(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('hold'),
  );
  const holdPending = !!s.cardHold && !s.cardHold.authorized;
  const payments = useQuery({
    queryKey: ['payments'],
    queryFn: api.payments,
    enabled: !!returned && holdPending,
    refetchInterval: (q) =>
      q.state.data?.find((i) => i.id === returned)?.status === 'PENDING' ? 3_000 : false,
  });
  const returnedHold = payments.data?.find((i) => i.id === returned);
  useEffect(() => {
    if (returnedHold?.status === 'AUTHORIZED')
      void queryClient.invalidateQueries({ queryKey: ['stay'] });
  }, [returnedHold?.status, queryClient]);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const hold = useMutation({
    mutationFn: () => api.hold(attemptKey),
    onSuccess: (intent) => {
      if (intent.status === 'AUTHORIZED')
        return queryClient.invalidateQueries({ queryKey: ['stay'] });
      if (intent.checkoutUrl) window.location.assign(intent.checkoutUrl);
    },
  });
  return (
    <Section
      icon={<KeyRound />}
      title="Check in online"
      description={
        s.verified
          ? 'Skip the queue: we assign your room now and tell you how to get your key.'
          : 'Confirm it is you first (above) to check in online.'
      }
    >
      <CardContent className="flex flex-col gap-3">
        {s.cardHold && (
          <div className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
            <span className="flex items-center justify-between gap-2">
              <span>
                Card hold for incidentals:{' '}
                <strong>{formatMoney(s.cardHold.requiredMinor, s.cardHold.currency)}</strong>
              </span>
              {s.cardHold.authorized && <Badge variant="success">Authorized</Badge>}
            </span>
            {!s.cardHold.authorized && (
              <>
                <span className="text-muted-foreground">
                  The amount is reserved on your card, not charged. You only pay for what you use;
                  the rest is released after check-out.
                </span>
                {returnedHold?.status === 'FAILED' && (
                  <Alert>Your card was declined. Try again or use another card.</Alert>
                )}
                {hold.error && <Alert>{errorMessage(hold.error)}</Alert>}
                <Button
                  variant="outline"
                  onClick={() => hold.mutate()}
                  loading={hold.isPending || returnedHold?.status === 'PENDING'}
                  disabled={!s.verified}
                >
                  {!hold.isPending && <CreditCard />}
                  Authorize card hold
                </Button>
              </>
            )}
          </div>
        )}
        {checkIn.error && <Alert>{errorMessage(checkIn.error)}</Alert>}
        <Button
          size="lg"
          onClick={() => checkIn.mutate()}
          loading={checkIn.isPending}
          disabled={!s.verified || holdPending}
        >
          {!checkIn.isPending && <DoorOpen />}
          Check in now
        </Button>
      </CardContent>
    </Section>
  );
}

function Requests() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<(typeof REQUEST_CATEGORIES)[number]>('TOWELS');
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
    <Section icon={<BellRing />} title="Need anything?">
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {create.error && <Alert>{errorMessage(create.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Request</Label>
            <NativeSelect
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              {REQUEST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="details">Details (optional)</Label>
            <Input
              id="details"
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" loading={create.isPending}>
            {!create.isPending && <Send />}
            Send request
          </Button>
        </form>
        {rate.error && <Alert>{errorMessage(rate.error)}</Alert>}
        {list.isPending && (
          <LoadingRegion label="Loading your requests…" className="flex flex-col gap-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </LoadingRegion>
        )}
        <ul className="stagger flex flex-col gap-2">
          {list.data?.map((r) => {
            const [label, variant] = STATUS_LABELS[r.status];
            return (
              <li key={r.id} className="flex flex-col gap-1 rounded-xl border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{CATEGORY_LABELS[r.category]}</span>
                  <Badge variant={variant} dot>
                    {label}
                  </Badge>
                </div>
                {r.description && <p className="text-muted-foreground">{r.description}</p>}
                {r.status === 'DONE' &&
                  (r.rating ? (
                    <p className="mt-1 flex items-center gap-1 text-muted-foreground">
                      <Star className="size-3.5 fill-warning text-warning" />
                      You rated this {r.rating}/5. Thank you!
                    </p>
                  ) : (
                    <StarRating
                      disabled={rate.isPending}
                      onRate={(rating) => rate.mutate({ id: r.id, rating })}
                    />
                  ))}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Section>
  );
}

function StarRating({ disabled, onRate }: { disabled: boolean; onRate: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">How did we do?</span>
      <div
        role="group"
        aria-label="Rate this request"
        className="flex"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${n} out of 5`}
            disabled={disabled}
            className="size-auto rounded p-1 duration-150 hover:scale-125 hover:bg-transparent active:scale-100 [&_svg]:size-5"
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onRate(n)}
          >
            <Star
              className={cn(
                'size-5 transition-colors',
                n <= hover ? 'fill-warning text-warning' : 'text-muted-foreground/50',
              )}
            />
          </Button>
        ))}
      </div>
    </div>
  );
}

function Bill() {
  const bill = useQuery({ queryKey: ['bill'], queryFn: api.bill });
  // Back from the hosted checkout: ?payment=<intent id>.
  const [returned] = useState(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('payment'),
  );
  const payments = useQuery({
    queryKey: ['payments'],
    queryFn: api.payments,
    enabled: !!returned,
    refetchInterval: (q) =>
      q.state.data?.find((i) => i.id === returned)?.status === 'PENDING' ? 3_000 : false,
  });
  const outcome = payments.data?.find((i) => i.id === returned);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (outcome?.status === 'SUCCEEDED') void queryClient.invalidateQueries({ queryKey: ['bill'] });
  }, [outcome?.status, queryClient]);
  const [attemptKey] = useState(() => crypto.randomUUID());
  const pay = useMutation({
    mutationFn: () => api.pay(undefined, attemptKey),
    onSuccess: (intent) => {
      if (intent.checkoutUrl) window.location.assign(intent.checkoutUrl);
    },
  });
  if (bill.isPending) return <SkeletonCard lines={3} />;
  if (!bill.data) return null;
  const { currency, lines, balanceMinor } = bill.data;
  return (
    <Section icon={<Receipt />} title="Your bill">
      <CardContent className="flex flex-col text-sm">
        {lines.length === 0 && (
          <p className="rounded-xl border border-dashed py-6 text-center text-muted-foreground">
            No charges yet.
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3 border-b py-2.5 last:border-0">
            <span className="flex flex-col">
              <span>{l.description}</span>
              <span className="text-xs text-muted-foreground">{formatDate(l.date)}</span>
            </span>
            <span className={cn('font-medium tabular-nums', l.amountMinor < 0 && 'text-success')}>
              {formatMoney(l.amountMinor, currency)}
            </span>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3">
          <span className="font-medium">Balance</span>
          <span
            className={cn(
              'text-lg font-semibold tabular-nums',
              balanceMinor <= 0 && 'text-success',
            )}
          >
            {formatMoney(balanceMinor, currency)}
          </span>
        </div>
        {outcome?.status === 'SUCCEEDED' && <Notice>Thank you, your payment was received.</Notice>}
        {outcome?.status === 'FAILED' && (
          <Alert>The payment did not go through. You can try again.</Alert>
        )}
        {pay.error && <Alert>{errorMessage(pay.error)}</Alert>}
        {balanceMinor > 0 && (
          <Button disabled={pay.isPending} onClick={() => pay.mutate()}>
            Pay {formatMoney(balanceMinor, currency)} now
          </Button>
        )}
      </CardContent>
    </Section>
  );
}

/** What's on at the hotel in the next 30 days (ADR-0026); hidden when nothing is planned. */
function HotelEvents({ timeZone }: { timeZone: string }) {
  const events = useQuery({ queryKey: ['events'], queryFn: api.events, retry: false });
  if (!events.data?.length) return null;
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-PH', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-PH', { timeZone, hour: 'numeric', minute: '2-digit' }).format(
      new Date(iso),
    );
  return (
    <Section icon={<PartyPopper />} title="What's on">
      <CardContent className="flex flex-col gap-3">
        {events.data.map((e) => (
          <div key={e.id} className="flex flex-col gap-0.5 rounded-xl border p-3">
            <p className="font-medium">{e.title}</p>
            <p className="text-sm text-muted-foreground">
              {day(e.startsAt)}
              {e.allDay ? '' : ` · ${time(e.startsAt)} – ${time(e.endsAt)}`}
            </p>
            {e.location && (
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5" />
                {e.location}
              </p>
            )}
            {e.description && <p className="mt-1 whitespace-pre-wrap text-sm">{e.description}</p>}
          </div>
        ))}
      </CardContent>
    </Section>
  );
}

function Contact({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.setQueryData(['stay'], undefined),
  });
  return (
    <footer className="flex flex-col items-center gap-3 pt-4 text-center text-sm text-muted-foreground">
      <span className="font-medium text-foreground">
        {s.property.name}
        {s.property.city && `, ${s.property.city}`}
      </span>
      {(s.property.phone || s.property.email) && (
        <div className="flex flex-wrap justify-center gap-2">
          {s.property.phone && (
            <a
              href={`tel:${s.property.phone}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Phone />
              {s.property.phone}
            </a>
          )}
          {s.property.email && (
            <a
              href={`mailto:${s.property.email}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Mail />
              {s.property.email}
            </a>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>
        {!logout.isPending && <LogOut />}
        Sign out on this device
      </Button>
      {logout.isSuccess && <span>Signed out. Your email link still works to sign back in.</span>}
    </footer>
  );
}
