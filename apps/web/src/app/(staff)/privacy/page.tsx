'use client';

import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Notice,
  PageHeader,
  Textarea,
  Toggle,
} from '@hotel/ui';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel } from '@/lib/status';

type Subject = 'guests' | 'employees';
interface Person {
  id: string;
  name: string;
  detail: string;
  canAnonymize: boolean;
  anonymized: boolean;
}

/**
 * Data requests (spec §45, ADR-0030): find a guest or an employee, download everything the
 * organization holds about them, or anonymize them where the law allows.
 */
export default function PrivacyPage() {
  const session = useSession();
  const [subject, setSubject] = useState<Subject>('guests');
  const [q, setQ] = useState('');
  const query = q.trim();
  const people = useQuery({
    queryKey: ['privacy-search', subject, query],
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Person[]> =>
      subject === 'guests'
        ? (await api.guests.search(query, 20)).map((g) => ({
            id: g.id,
            name: `${g.firstName} ${g.lastName}`,
            detail: [g.email, g.phone].filter(Boolean).join(' · '),
            canAnonymize: true,
            anonymized: false,
          }))
        : (await api.hr.employees({ q: query, limit: 20 })).map((e) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`,
            detail: `${e.employeeNo} · ${statusLabel(e.status)}`,
            canAnonymize: e.status === 'TERMINATED',
            anonymized: e.firstName === 'Former',
          })),
  });

  if (session.data && !hasPermission(session.data, 'privacy.manage'))
    return <EmptyState icon={<ShieldCheck />} title={t('priv.noAccess')} />;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('priv.title')} description={t('priv.hint')} />
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 text-sm">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('priv.subject')}>
            {(['guests', 'employees'] as const).map((s) => (
              <Toggle
                key={s}
                variant="outline"
                pressed={subject === s}
                onPressedChange={() => setSubject(s)}
              >
                {t(`priv.${s}`)}
              </Toggle>
            ))}
          </div>
          <Label className="flex flex-col gap-1">
            {t('priv.search')}
            <Input
              value={q}
              placeholder={subject === 'guests' ? t('priv.guestHint') : t('priv.employeeHint')}
              onChange={(e) => setQ(e.target.value)}
            />
          </Label>
          {people.error && <Alert>{errorMessage(people.error)}</Alert>}
          {query.length >= 2 && people.data?.length === 0 && (
            <p className="text-muted-foreground">{t('priv.nobody')}</p>
          )}
          {people.data?.map((p) => (
            <PersonRow key={p.id} subject={subject} person={p} />
          ))}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t('priv.kept')}</p>
    </div>
  );
}

function PersonRow({ subject, person: p }: { subject: Subject; person: Person }) {
  const [reason, setReason] = useState('');
  const anonymize = useMutation({
    mutationFn: () =>
      subject === 'guests'
        ? api.privacy.anonymizeGuest(p.id, reason.trim())
        : api.privacy.anonymizeEmployee(p.id, reason.trim()),
  });
  const exportUrl =
    subject === 'guests' ? api.privacy.guestExportUrl(p.id) : api.privacy.employeeExportUrl(p.id);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="font-medium">{p.name}</span>
          <span className="text-muted-foreground">{p.detail}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={exportUrl} download>
              <Download />
              {t('priv.download')}
            </a>
          </Button>
          {!anonymize.isSuccess && !p.anonymized && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="hover:text-destructive"
                  disabled={!p.canAnonymize}
                  title={p.canAnonymize ? undefined : t('priv.onlyFormer')}
                >
                  <UserX />
                  {t('priv.anonymize')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('priv.anonymizeName', { name: p.name })}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {subject === 'guests' ? t('priv.guestEffect') : t('priv.employeeEffect')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Label className="flex flex-col gap-1 text-sm">
                  {t('priv.reason')}
                  <Textarea
                    rows={2}
                    maxLength={300}
                    placeholder={t('priv.reasonHint')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Label>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('fin.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={reason.trim().length < 5}
                    onClick={() => anonymize.mutate()}
                  >
                    {t('priv.anonymize')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </span>
      </div>
      {anonymize.error && <Alert>{errorMessage(anonymize.error)}</Alert>}
      {anonymize.isSuccess && <Notice>{t('priv.done')}</Notice>}
    </div>
  );
}
