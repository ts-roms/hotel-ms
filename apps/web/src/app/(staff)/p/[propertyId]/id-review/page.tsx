'use client';

import type { IdentityDocument } from '@hotel/contracts';
import { formatDate, formatDateTime } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Input,
  PageHeader,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IdCard } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, usePropertyId, usePropertyTimeZone } from '@/lib/property';
import { enumLabel, enumLabelOr, statusLabel, statusVariant } from '@/lib/status';

const FILTERS = [
  { key: 'PENDING', label: 'idr.pending' },
  { key: 'APPROVED', label: 'idr.approved' },
  { key: 'REJECTED', label: 'idr.rejected' },
  { key: 'ALL', label: 'idr.all' },
] as const;

/** Guest IDs uploaded in the guest portal, for the front desk to review (ADR-0027). */
export default function IdReviewPage() {
  const propertyId = usePropertyId();
  const pms = usePms(propertyId);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('PENDING');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['guest-ids', propertyId, filter],
    queryFn: () => pms.guestIds(filter),
  });
  const current = list.data?.find((d) => d.id === selected);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('idr.title')} description={t('idr.hint')} />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? 'default' : 'outline'}
            onClick={() => {
              setFilter(f.key);
              setSelected(null);
            }}
          >
            {t(f.label)}
          </Button>
        ))}
      </div>
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-2">
          {list.data?.length === 0 && <EmptyState icon={<IdCard />} title={t('idr.none')} />}
          {list.data?.map((d) => (
            <Button
              key={d.id}
              type="button"
              variant="outline"
              onClick={() => setSelected(d.id)}
              className={cn(
                'h-auto flex-col items-stretch justify-start gap-1 whitespace-normal rounded-xl p-3 text-left font-normal text-foreground hover:border-primary/40 hover:bg-card hover:text-foreground active:scale-100',
                selected === d.id && 'border-primary hover:border-primary',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{d.guestName}</span>
                <Badge variant={statusVariant(d.status)} dot>
                  {statusLabel(d.status)}
                </Badge>
              </span>
              <span className="text-muted-foreground">
                {enumLabel('idType', d.documentType)} · {d.confirmationNo} ·{' '}
                {formatDate(d.arrivalDate)} → {formatDate(d.departureDate)}
              </span>
            </Button>
          ))}
        </div>
        {current && (
          <Review key={`${current.id}:${current.version}`} propertyId={propertyId} doc={current} />
        )}
      </div>
    </div>
  );
}

function Review({ propertyId, doc: d }: { propertyId: string; doc: IdentityDocument }) {
  const timeZone = usePropertyTimeZone();
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      pms.reviewGuestId(d.id, d.version, { decision, reason: reason.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guest-ids', propertyId] }),
  });
  const url = pms.guestIdContentUrl(d.id);

  return (
    <Card className="lg:sticky lg:top-4 lg:self-start">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          {d.guestName}
          <Link
            className="text-sm font-normal text-primary hover:underline"
            href={`/p/${propertyId}/reservations/${d.reservationId}`}
          >
            {d.confirmationNo}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          {enumLabel('idType', d.documentType)} ·{' '}
          {t('idr.uploadedAt', { time: formatDateTime(d.uploadedAt, { timeZone }) })} ·{' '}
          {enumLabelOr('status', d.stayStatus)}
        </p>
        {d.purged ? (
          <p className="text-muted-foreground">{t('idr.purged')}</p>
        ) : d.contentType === 'application/pdf' ? (
          <Button variant="outline" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              {t('idr.openPdf')}
            </a>
          </Button>
        ) : (
          // The API serves the file privately (no-store); every view is audited.
          <img
            src={url}
            alt={t('idr.imageAlt')}
            className="max-h-[28rem] w-full rounded-lg border object-contain"
          />
        )}
        {d.status === 'REJECTED' && d.rejectionReason && (
          <p>
            <strong>{t('idr.reason')}:</strong> {d.rejectionReason}
          </p>
        )}
        {d.reviewerName && d.reviewedAt && (
          <p className="text-muted-foreground">
            {t('idr.reviewedBy', {
              status: statusLabel(d.status),
              name: d.reviewerName,
              time: formatDateTime(d.reviewedAt, { timeZone }),
            })}
          </p>
        )}
        {review.error && <Alert>{errorMessage(review.error)}</Alert>}
        {d.status === 'PENDING' && (
          <div className="flex flex-col gap-2">
            <Input
              aria-label={t('idr.reason')}
              placeholder={t('idr.reasonHint')}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button loading={review.isPending} onClick={() => review.mutate('APPROVE')}>
                {t('idr.approve')}
              </Button>
              <Button
                variant="outline"
                className="hover:text-destructive"
                disabled={reason.trim().length < 3 || review.isPending}
                onClick={() => review.mutate('REJECT')}
              >
                {t('idr.reject')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
