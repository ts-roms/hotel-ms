'use client';

import { type DocumentRetention, EMPLOYEE_DOCUMENT_CATEGORIES } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, Input, Label, Notice, PageHeader } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { DOCUMENT_CATEGORY_LABELS } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';

type Rules = DocumentRetention['rules'];

/** Retention of employee documents after termination, per category (ADR-0021). */
export default function DocumentRetentionPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const retention = useQuery({
    queryKey: ['document-retention'],
    queryFn: api.hr.documentRetention,
  });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const values: Record<string, string> =
    draft ??
    Object.fromEntries(
      EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => [c, String(retention.data?.rules[c] ?? '')]),
    );
  const save = useMutation({
    mutationFn: () =>
      api.hr.setDocumentRetention(
        Object.fromEntries(
          EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => [c, values[c] ? Number(values[c]) : null]),
        ) as Rules,
      ),
    onSuccess: (data) => {
      setDraft(null);
      queryClient.setQueryData(['document-retention'], data);
    },
  });
  // Setting the policy needs the permission at organization scope.
  const canEdit = !!session.data?.grants.some(
    (g) => g.permission === 'employee.documents' && g.scopeType === 'ORGANIZATION',
  );
  const invalid = Object.values(values).some((v) => v !== '' && !/^[1-9]\d{0,3}$/.test(v));

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <PageHeader title={t('hr.retentionTitle')} description={t('hr.retentionHint')} />
      {retention.error && <Alert>{errorMessage(retention.error)}</Alert>}
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      {save.isSuccess && <Notice>{t('hr.retentionSaved')}</Notice>}
      <Card>
        <CardContent className="pt-5">
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {EMPLOYEE_DOCUMENT_CATEGORIES.map((c) => (
              <Label key={c} className="flex items-center justify-between gap-3 font-normal">
                <span>{DOCUMENT_CATEGORY_LABELS[c]}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Input
                    className="w-24 text-right"
                    inputMode="numeric"
                    placeholder={t('hr.keep')}
                    disabled={!canEdit}
                    value={values[c]}
                    onChange={(e) => setDraft({ ...values, [c]: e.target.value.trim() })}
                  />
                  {t('hr.monthsAfterTermination')}
                </span>
              </Label>
            ))}
            {canEdit && (
              <Button
                type="submit"
                className="self-start"
                loading={save.isPending}
                disabled={invalid || !draft}
              >
                {t('hr.save')}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
      <PhotoRetention />
    </div>
  );
}

/** Days punch selfies are kept (ADR-0022); HR with organization-wide attendance.manage. */
function PhotoRetention() {
  const session = useSession();
  const queryClient = useQueryClient();
  const retention = useQuery({ queryKey: ['photo-retention'], queryFn: api.hr.photoRetention });
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(retention.data?.days ?? '');
  const save = useMutation({
    mutationFn: () => api.hr.setPhotoRetention(Number(value)),
    onSuccess: (data) => {
      setDraft(null);
      queryClient.setQueryData(['photo-retention'], data);
    },
  });
  const canEdit = !!session.data?.grants.some(
    (g) => g.permission === 'attendance.manage' && g.scopeType === 'ORGANIZATION',
  );
  const days = Number(value);
  if (retention.error) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5 text-sm">
        <strong>{t('clock.retentionTitle')}</strong>
        <p className="text-muted-foreground">{t('clock.retentionHint')}</p>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Notice>{t('clock.retentionSaved')}</Notice>}
        <form
          className="flex items-center gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <span>{t('clock.keepDays')}</span>
          <Input
            className="w-24 text-right"
            inputMode="numeric"
            aria-label={t('clock.retentionTitle')}
            disabled={!canEdit}
            value={value}
            onChange={(e) => setDraft(e.target.value.trim())}
          />
          <span className="text-muted-foreground">{t('clock.days')}</span>
          {canEdit && (
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!draft || !Number.isInteger(days) || days < 7 || days > 365}
            >
              {t('hr.save')}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
