'use client';

import { formatDate, localToday } from '@hotel/format';
import { Alert, Button, Input, Label, NativeSelect, Textarea } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { RecordSection } from './record-section';

/** Performance reviews (employee.performance, two-step verification). */
export function ReviewsCard({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ['reviews', employeeId],
    queryFn: () => api.hr.reviews(employeeId),
    retry: false,
  });
  const empty = {
    reviewDate: localToday(),
    periodFrom: '',
    periodTo: '',
    rating: 3,
    summary: '',
    strengths: '',
    improvements: '',
    goals: '',
  };
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      api.hr.addReview(employeeId, {
        ...form,
        periodFrom: form.periodFrom || null,
        periodTo: form.periodTo || null,
      }),
    onSuccess: (items) => {
      queryClient.setQueryData(['reviews', employeeId], items);
      setForm(empty);
      setOpen(false);
    },
  });
  const text = (key: 'summary' | 'strengths' | 'improvements' | 'goals', label: string) => (
    <Label className="flex flex-col gap-1">
      {label}
      <Textarea
        rows={2}
        maxLength={4000}
        required={key === 'summary'}
        value={form[key]}
        onChange={(ev) => setForm({ ...form, [key]: ev.target.value })}
      />
    </Label>
  );

  return (
    <RecordSection icon={<Star />} title={t('hrx.reviews')}>
      {reviews.error && <Alert>{errorMessage(reviews.error)}</Alert>}
      {reviews.data?.length === 0 && <p className="text-muted-foreground">{t('hrx.none')}</p>}
      {reviews.data?.map((r) => (
        <div key={r.id} className="flex flex-col gap-1 rounded-lg border p-3">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {formatDate(r.reviewDate)}
              {r.periodFrom && r.periodTo && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · {formatDate(r.periodFrom)} → {formatDate(r.periodTo)}
                </span>
              )}
            </span>
            <span className="text-primary" aria-label={`${r.rating} / 5`}>
              {'★'.repeat(r.rating)}
              <span className="text-muted-foreground/40">{'★'.repeat(5 - r.rating)}</span>
            </span>
          </span>
          <p className="whitespace-pre-wrap">{r.summary}</p>
          {r.strengths && (
            <p className="text-muted-foreground">
              <strong>{t('hrx.strengths')}:</strong> {r.strengths}
            </p>
          )}
          {r.improvements && (
            <p className="text-muted-foreground">
              <strong>{t('hrx.improvements')}:</strong> {r.improvements}
            </p>
          )}
          {r.goals && (
            <p className="text-muted-foreground">
              <strong>{t('hrx.goals')}:</strong> {r.goals}
            </p>
          )}
          {r.reviewerName && <p className="text-xs text-muted-foreground">{r.reviewerName}</p>}
        </div>
      ))}
      {reviews.data && !open && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
          {t('hrx.writeReview')}
        </Button>
      )}
      {open && (
        <form
          className="flex flex-col gap-3 border-t pt-3"
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault();
            add.mutate();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-4">
            <Label className="flex flex-col gap-1">
              {t('hrx.reviewDate')}
              <Input
                type="date"
                required
                value={form.reviewDate}
                onChange={(ev) => setForm({ ...form, reviewDate: ev.target.value })}
              />
            </Label>
            <Label className="flex flex-col gap-1">
              {t('hrx.periodFrom')}
              <Input
                type="date"
                value={form.periodFrom}
                onChange={(ev) => setForm({ ...form, periodFrom: ev.target.value })}
              />
            </Label>
            <Label className="flex flex-col gap-1">
              {t('hrx.periodTo')}
              <Input
                type="date"
                value={form.periodTo}
                onChange={(ev) => setForm({ ...form, periodTo: ev.target.value })}
              />
            </Label>
            <Label className="flex flex-col gap-1">
              {t('hrx.rating')}
              <NativeSelect
                value={String(form.rating)}
                onChange={(ev) => setForm({ ...form, rating: Number(ev.target.value) })}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} · {t(`hrx.rating.${n}` as 'hrx.rating.1')}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          </div>
          {text('summary', t('hrx.summary'))}
          {text('strengths', t('hrx.strengths'))}
          {text('improvements', t('hrx.improvements'))}
          {text('goals', t('hrx.goals'))}
          {add.error && <Alert>{errorMessage(add.error)}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={add.isPending} disabled={!form.summary.trim()}>
              {t('hrx.saveReview')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('fin.cancel')}
            </Button>
          </div>
        </form>
      )}
    </RecordSection>
  );
}
