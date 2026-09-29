'use client';

import { GUEST_ID_TYPES, type GuestIdType, type GuestStay } from '@hotel/contracts';
import { elapsed } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  CardContent,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Notice,
  NativeSelect,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  Clock,
  IdCard,
  LogOut,
  Sparkles,
  Upload,
  Wifi,
} from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { Section } from '@/components/section';
import { api, errorMessage, rememberStay } from '@/lib/api';

/**
 * Guest portal extras (ADR-0027): the notification feed, the ID upload, hotel information
 * and "request checkout".
 */

const ID_LABELS: Record<GuestIdType, string> = {
  PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's license",
  NATIONAL_ID: 'National ID',
  OTHER: 'Other government ID',
};

const timeAgo = (iso: string) => {
  const e = elapsed(iso);
  if (e.unit === 'now') return 'just now';
  if (e.unit === 'minutes') return `${e.value} min ago`;
  if (e.unit === 'hours') return `${e.value} h ago`;
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
};

/** Updates from the hotel: requests, orders, the ID review, checkout, front desk messages. */
export function Notifications({ unread }: { unread: number }) {
  const queryClient = useQueryClient();
  const [all, setAll] = useState(false);
  const feed = useQuery({
    queryKey: ['guest-notifications'],
    queryFn: api.notifications,
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: api.markNotificationsRead,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['guest-notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['stay'] }),
      ]),
  });
  const items = feed.data ?? [];
  if (items.length === 0) return null;
  return (
    <Section
      icon={<Bell />}
      title={
        <span className="flex items-center gap-2">
          Updates
          {unread > 0 && <Badge variant="primary">{unread} new</Badge>}
        </span>
      }
    >
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {(all ? items : items.slice(0, 5)).map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border p-3 text-sm ${n.read ? '' : 'border-primary/40 bg-primary/5'}`}
            >
              <p className="flex items-start justify-between gap-2">
                <span className="font-medium">{n.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(n.createdAt)}
                </span>
              </p>
              {n.body && <p className="mt-0.5 text-muted-foreground">{n.body}</p>}
            </li>
          ))}
        </ul>
        {!all && items.length > 5 && (
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            Show all {items.length}
          </Button>
        )}
        {unread > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            loading={read.isPending}
            onClick={() => read.mutate()}
          >
            <Check />
            Mark all as read
          </Button>
        )}
      </CardContent>
    </Section>
  );
}

/** A photo or scan of an ID, for the front desk to approve (ADR-0027). */
export function IdUpload({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<GuestIdType>(s.identity?.documentType ?? 'PASSPORT');
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadId(file, type),
    onSuccess: (stay) => {
      queryClient.setQueryData(['stay'], rememberStay(stay));
      if (input.current) input.current.value = '';
    },
  });
  const id = s.identity;

  if (id?.status === 'APPROVED') {
    return (
      <Section
        icon={<IdCard />}
        title="ID approved"
        description={`Your ${ID_LABELS[id.documentType].toLowerCase()} was checked by the front desk.`}
      />
    );
  }
  return (
    <Section
      icon={<IdCard />}
      title="Your ID"
      description={
        s.identityRequired
          ? 'The hotel checks an ID before online check-in. Upload a clear photo of it.'
          : 'Save time at the front desk: upload a clear photo of your ID.'
      }
    >
      <CardContent className="flex flex-col gap-3">
        {id?.status === 'PENDING' && (
          <Notice>
            <Clock className="mr-1 inline size-4" />
            Uploaded. The front desk will check it shortly.
          </Notice>
        )}
        {id?.status === 'REJECTED' && (
          <Alert>
            The front desk asked for another photo
            {id.rejectionReason ? `: ${id.rejectionReason}` : '.'}
          </Alert>
        )}
        {upload.error && <Alert>{errorMessage(upload.error)}</Alert>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="id-type">Type of ID</Label>
          <NativeSelect
            id="id-type"
            value={type}
            onChange={(e) => setType(e.target.value as GuestIdType)}
          >
            {GUEST_ID_TYPES.map((t) => (
              <option key={t} value={t}>
                {ID_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          aria-label="ID photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
          }}
        />
        <Button
          size="lg"
          variant={id ? 'outline' : 'default'}
          loading={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {!upload.isPending && <Upload />}
          {id ? 'Upload a new photo' : 'Upload a photo'}
        </Button>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP or PDF, up to 8 MB. Only the front desk sees it, and it is deleted 30 days
          after your stay.
        </p>
      </CardContent>
    </Section>
  );
}

/** About the hotel: what it offers, its services, the Wi-Fi once checked in, house rules. */
export function HotelInfo({ stay: s }: { stay: GuestStay }) {
  // The Wi-Fi appears once the guest is verified and in house: refetch when either changes.
  const info = useQuery({
    queryKey: ['hotel-info', s.verified, s.stay.status],
    queryFn: api.hotelInfo,
    retry: false,
  });
  const h = info.data;
  if (!h) return null;
  const empty =
    !h.about && h.amenities.length === 0 && h.services.length === 0 && !h.houseRules && !h.wifi;
  if (empty) return null;
  return (
    <Section icon={<Building2 />} title={`About ${h.name}`} description={h.address || undefined}>
      <CardContent className="flex flex-col gap-4 text-sm">
        {h.about && <p className="whitespace-pre-wrap">{h.about}</p>}
        {h.wifi && (
          <div className="flex items-start gap-3 rounded-xl border p-3">
            <Wifi className="mt-0.5 size-4 text-primary" />
            <div>
              <p className="font-medium">{h.wifi.name}</p>
              <p className="text-muted-foreground">
                Password: <span className="font-mono text-foreground">{h.wifi.password}</span>
              </p>
            </div>
          </div>
        )}
        {h.amenities.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {h.amenities.map((a) => (
              <span
                key={a}
                className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
              >
                <Sparkles className="size-3 text-primary" />
                {a}
              </span>
            ))}
          </div>
        )}
        {h.services.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border">
            {h.services.map((service) => (
              <li key={service.name} className="flex flex-col gap-0.5 p-3">
                <span className="flex justify-between gap-2">
                  <span className="font-medium">{service.name}</span>
                  {service.hours && (
                    <span className="text-xs text-muted-foreground">{service.hours}</span>
                  )}
                </span>
                {service.description && (
                  <span className="text-muted-foreground">{service.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {h.houseRules && (
          <Collapsible className="group rounded-xl border p-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md text-left font-medium focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25">
              House rules
              <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="animate-fade-in">
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{h.houseRules}</p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Section>
  );
}

/** "Ready to leave?": asks the front desk to prepare the checkout. */
export function CheckoutRequest({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const request = useMutation({
    mutationFn: () => api.requestCheckout({ time: time || null, note: note.trim() }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stay'] }),
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
      ]),
  });
  if (s.checkoutRequested) {
    return (
      <Section
        icon={<LogOut />}
        title="Checkout requested"
        description="The front desk is preparing your bill. Drop by the front desk with your key when you leave."
      />
    );
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    request.mutate();
  };
  return (
    <Section
      icon={<LogOut />}
      title="Ready to leave?"
      description={`Check-out is by ${s.property.checkOutTime}. Let the front desk know and they will have your bill ready.`}
    >
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {request.error && <Alert>{errorMessage(request.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="checkout-time">Leaving at (optional)</Label>
            <Input
              id="checkout-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="checkout-note">Anything we should know? (optional)</Label>
            <Input
              id="checkout-note"
              maxLength={500}
              placeholder="e.g. please call a taxi"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" variant="outline" loading={request.isPending}>
            {!request.isPending && <LogOut />}
            Request checkout
          </Button>
        </form>
      </CardContent>
    </Section>
  );
}
