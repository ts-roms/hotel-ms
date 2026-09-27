'use client';

import { type DocumentRetention, EMPLOYEE_DOCUMENT_CATEGORIES } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, Input, Notice, PageHeader } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { CATEGORY_LABELS } from '../employees/[employeeId]/documents';

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
              <label key={c} className="flex items-center justify-between gap-3">
                <span>{CATEGORY_LABELS[c]}</span>
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
              </label>
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
    </div>
  );
}
