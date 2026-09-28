'use client';

import { EMPLOYMENT_TYPES, type Employee, PAY_BASES, type TrainingRecord } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Banknote, ClipboardCheck, Star, Trash2, UserRound } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney, parseMoney } from '@/lib/format';
import { today } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { statusLabel } from '@/lib/status';

/**
 * The employee's file beyond the profile (ADR-0028): employment type and emergency
 * contact, pay history, trainings and certifications, performance reviews.
 */

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

/** Employment type (employee.manage) and emergency contact (personal details). */
export function EmploymentDetails({
  employee: e,
  canManage,
}: {
  employee: Employee;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const contact = e.personal?.emergencyContact ?? null;
  const [type, setType] = useState(e.employmentType);
  const [name, setName] = useState(contact?.name ?? '');
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.hr.updateEmployee(e.id, e.version, {
        employmentType: type,
        ...(e.personal
          ? {
              personal: {
                emergencyContact: name.trim()
                  ? { name: name.trim(), relationship: relationship.trim(), phone: phone.trim() }
                  : null,
              },
            }
          : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['employee', e.id], data);
      setEditing(false);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Section icon={<UserRound />} title={t('hrx.employment')}>
      {!editing ? (
        <>
          <p>
            {t('hrx.employmentType')}: <strong>{statusLabel(e.employmentType)}</strong>
          </p>
          {e.personal ? (
            <p>
              {t('hrx.emergencyContact')}:{' '}
              {contact ? (
                <strong>
                  {contact.name}
                  {contact.relationship && ` (${contact.relationship})`} · {contact.phone}
                </strong>
              ) : (
                <span className="text-muted-foreground">{t('hrx.none')}</span>
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">{t('hr.personalHidden')}</p>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setEditing(true)}
            >
              {t('hrx.edit')}
            </Button>
          )}
        </>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Label className="flex flex-col gap-1">
            {t('hrx.employmentType')}
            <Select value={type} onChange={(ev) => setType(ev.target.value as typeof type)}>
              {EMPLOYMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {statusLabel(x)}
                </option>
              ))}
            </Select>
          </Label>
          {e.personal && (
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-1 font-medium">{t('hrx.emergencyContact')}</legend>
              <Input
                aria-label={t('hrx.contactName')}
                placeholder={t('hrx.contactName')}
                maxLength={120}
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
              <Input
                aria-label={t('hrx.relationship')}
                placeholder={t('hrx.relationship')}
                maxLength={60}
                value={relationship}
                onChange={(ev) => setRelationship(ev.target.value)}
              />
              <Input
                aria-label={t('hrx.phone')}
                placeholder={t('hrx.phone')}
                maxLength={40}
                required={!!name.trim()}
                value={phone}
                onChange={(ev) => setPhone(ev.target.value)}
              />
            </fieldset>
          )}
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              {t('hrx.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('fin.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

/** Pay history (employee.compensation, two-step verification). */
export function CompensationCard({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const pay = useQuery({
    queryKey: ['compensation', employeeId],
    queryFn: () => api.hr.compensation(employeeId),
    retry: false,
  });
  const [form, setForm] = useState({
    effectiveFrom: today(),
    payBasis: 'MONTHLY' as (typeof PAY_BASES)[number],
    amount: '',
    currency: 'PHP',
    notes: '',
  });
  const amountMinor = parseMoney(form.amount, form.currency);
  const add = useMutation({
    mutationFn: () =>
      api.hr.addCompensation(employeeId, {
        effectiveFrom: form.effectiveFrom,
        payBasis: form.payBasis,
        amountMinor: amountMinor ?? 0,
        currency: form.currency,
        notes: form.notes,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['compensation', employeeId], data);
      setForm({ ...form, amount: '', notes: '' });
    },
  });
  const per = (basis: string) => t(`hrx.per.${basis}` as 'hrx.per.MONTHLY');

  return (
    <Section icon={<Banknote />} title={t('hrx.pay')}>
      {pay.error && <Alert>{errorMessage(pay.error)}</Alert>}
      {pay.data && (
        <>
          <p>
            {t('hrx.currentPay')}:{' '}
            {pay.data.current ? (
              <strong className="tabular-nums">
                {formatMoney(pay.data.current.amountMinor, pay.data.current.currency)}{' '}
                {per(pay.data.current.payBasis)}
              </strong>
            ) : (
              <span className="text-muted-foreground">{t('hrx.none')}</span>
            )}
          </p>
          {pay.data.history.map((c) => (
            <div
              key={c.id}
              className="flex justify-between gap-2 border-t pt-2 text-muted-foreground"
            >
              <span>
                {t('hrx.from')} {formatDate(c.effectiveFrom)}
                {c.notes && ` · ${c.notes}`}
                {c.createdByName && ` · ${c.createdByName}`}
              </span>
              <span className="tabular-nums">
                {formatMoney(c.amountMinor, c.currency)} {per(c.payBasis)}
              </span>
            </div>
          ))}
          <form
            className="flex flex-wrap items-center gap-2 border-t pt-3"
            onSubmit={(ev: FormEvent) => {
              ev.preventDefault();
              add.mutate();
            }}
          >
            <Input
              type="date"
              className="w-auto"
              aria-label={t('hrx.effectiveFrom')}
              value={form.effectiveFrom}
              onChange={(ev) => setForm({ ...form, effectiveFrom: ev.target.value })}
            />
            <Input
              className="w-32"
              inputMode="decimal"
              aria-label={t('hrx.amount')}
              placeholder={t('hrx.amount')}
              value={form.amount}
              onChange={(ev) => setForm({ ...form, amount: ev.target.value })}
            />
            <Input
              className="w-20"
              maxLength={3}
              aria-label={t('fin.currency')}
              value={form.currency}
              onChange={(ev) => setForm({ ...form, currency: ev.target.value.toUpperCase() })}
            />
            <Select
              className="w-auto"
              aria-label={t('hrx.payBasis')}
              value={form.payBasis}
              onChange={(ev) =>
                setForm({ ...form, payBasis: ev.target.value as (typeof PAY_BASES)[number] })
              }
            >
              {PAY_BASES.map((b) => (
                <option key={b} value={b}>
                  {per(b)}
                </option>
              ))}
            </Select>
            <Input
              className="min-w-40 flex-1"
              aria-label={t('hr.note')}
              placeholder={t('hr.note')}
              maxLength={500}
              value={form.notes}
              onChange={(ev) => setForm({ ...form, notes: ev.target.value })}
            />
            <Button
              type="submit"
              variant="outline"
              loading={add.isPending}
              disabled={amountMinor === null || !form.effectiveFrom}
            >
              {t('hrx.recordPay')}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">{t('hrx.payHint')}</p>
          {add.error && <Alert>{errorMessage(add.error)}</Alert>}
        </>
      )}
    </Section>
  );
}

const EXPIRY_BADGE: Record<
  NonNullable<TrainingRecord['expiry']>,
  'success' | 'warning' | 'danger'
> = {
  VALID: 'success',
  EXPIRING: 'warning',
  EXPIRED: 'danger',
};

/** Trainings and certifications (employee.read; employee.manage records them). */
export function TrainingCard({
  employeeId,
  canManage,
}: {
  employeeId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: ['training', employeeId],
    queryFn: () => api.hr.trainings(employeeId),
  });
  const empty = {
    kind: 'CERTIFICATION' as TrainingRecord['kind'],
    title: '',
    provider: '',
    completedOn: '',
    expiresOn: '',
  };
  const [form, setForm] = useState(empty);
  const set = (items: TrainingRecord[]) =>
    queryClient.setQueryData(['training', employeeId], items);
  const add = useMutation({
    mutationFn: () =>
      api.hr.addTraining(employeeId, {
        kind: form.kind,
        title: form.title,
        provider: form.provider,
        completedOn: form.completedOn || null,
        expiresOn: form.expiresOn || null,
      }),
    onSuccess: (items) => {
      set(items);
      setForm(empty);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.hr.removeTraining(employeeId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['training', employeeId] }),
  });

  return (
    <Section icon={<Award />} title={t('hrx.training')}>
      {records.error && <Alert>{errorMessage(records.error)}</Alert>}
      {records.data?.length === 0 && <p className="text-muted-foreground">{t('hrx.none')}</p>}
      {records.data?.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
        >
          <span className="flex flex-col">
            <span className="font-medium">
              {r.title}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {statusLabel(r.kind)}
              </span>
            </span>
            <span className="text-muted-foreground">
              {[r.provider, r.completedOn && `${t('hrx.completed')} ${formatDate(r.completedOn)}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {r.expiresOn && r.expiry && (
              <Badge variant={EXPIRY_BADGE[r.expiry]} dot>
                {t(`hrx.expiry.${r.expiry}` as 'hrx.expiry.VALID')} {formatDate(r.expiresOn)}
              </Badge>
            )}
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('hrx.remove')}
                disabled={remove.isPending}
                onClick={() => remove.mutate(r.id)}
              >
                <Trash2 />
              </Button>
            )}
          </span>
        </div>
      ))}
      {canManage && (
        <form
          className="grid gap-2 border-t pt-3 sm:grid-cols-2"
          onSubmit={(ev: FormEvent) => {
            ev.preventDefault();
            add.mutate();
          }}
        >
          <Select
            aria-label={t('hrx.kind')}
            value={form.kind}
            onChange={(ev) => setForm({ ...form, kind: ev.target.value as TrainingRecord['kind'] })}
          >
            <option value="CERTIFICATION">{statusLabel('CERTIFICATION')}</option>
            <option value="TRAINING">{statusLabel('TRAINING')}</option>
          </Select>
          <Input
            required
            maxLength={160}
            aria-label={t('hrx.title')}
            placeholder={t('hrx.title')}
            value={form.title}
            onChange={(ev) => setForm({ ...form, title: ev.target.value })}
          />
          <Input
            maxLength={160}
            aria-label={t('hrx.provider')}
            placeholder={t('hrx.provider')}
            value={form.provider}
            onChange={(ev) => setForm({ ...form, provider: ev.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Label className="flex flex-col gap-1 text-xs">
              {t('hrx.completed')}
              <Input
                type="date"
                value={form.completedOn}
                onChange={(ev) => setForm({ ...form, completedOn: ev.target.value })}
              />
            </Label>
            <Label className="flex flex-col gap-1 text-xs">
              {t('hrx.expires')}
              <Input
                type="date"
                value={form.expiresOn}
                onChange={(ev) => setForm({ ...form, expiresOn: ev.target.value })}
              />
            </Label>
          </div>
          <Button
            type="submit"
            variant="outline"
            className="self-start"
            loading={add.isPending}
            disabled={!form.title.trim()}
          >
            <ClipboardCheck />
            {t('hrx.addRecord')}
          </Button>
          {add.error && <Alert className="sm:col-span-2">{errorMessage(add.error)}</Alert>}
        </form>
      )}
    </Section>
  );
}

/** Performance reviews (employee.performance, two-step verification). */
export function ReviewsCard({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ['reviews', employeeId],
    queryFn: () => api.hr.reviews(employeeId),
    retry: false,
  });
  const empty = {
    reviewDate: today(),
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
    <Section icon={<Star />} title={t('hrx.reviews')}>
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
              <Select
                value={String(form.rating)}
                onChange={(ev) => setForm({ ...form, rating: Number(ev.target.value) })}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} · {t(`hrx.rating.${n}` as 'hrx.rating.1')}
                  </option>
                ))}
              </Select>
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
    </Section>
  );
}
