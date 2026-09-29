'use client';

import { DEPARTMENTS } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
} from '@hotel/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { enumLabel, enumLabelOr } from '@/lib/status';
import { useAction } from '@/lib/use-action';

export function DiscountProfiles({
  propertyId,
  canManage,
}: {
  propertyId: string;
  canManage: boolean;
}) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const profiles = useQuery({
    queryKey: ['discount-profiles', propertyId],
    queryFn: pms.discountProfiles,
  });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('20');
  const [exempt, setExempt] = useState('VAT');
  const [departments, setDepartments] = useState<string[]>(['ROOM', 'FNB']);
  const act = useAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discount-profiles', propertyId] }),
  });
  const create = () =>
    act.mutate(async () => {
      await pms.createDiscountProfile({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        discountPercent: Number(percent),
        exemptTaxCodes: exempt
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        departments: departments as (typeof DEPARTMENTS)[number][],
      });
      setCode('');
      setName('');
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.discountProfiles')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {profiles.data?.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
          >
            <span className={p.active ? '' : 'text-muted-foreground'}>
              <strong>{p.code}</strong> {p.name} · {p.discountPercent}%
              {p.exemptTaxCodes.length > 0 && ` · ${p.exemptTaxCodes.join(', ')}-exempt`} ·{' '}
              {p.departments.map((d) => enumLabelOr('department', d)).join(', ')}
              {!p.active && <Badge className="ml-2">{t('fin.archived')}</Badge>}
            </span>
            {canManage && p.active && (
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending}
                onClick={() => act.mutate(() => pms.archiveDiscountProfile(p.id))}
              >
                {t('fin.archive')}
              </Button>
            )}
          </div>
        ))}
        {canManage && (
          <form
            className="grid gap-2 border-t pt-2 sm:grid-cols-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create();
            }}
          >
            <Input
              required
              aria-label={t('fin.code')}
              placeholder={t('fin.code')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Input
              required
              aria-label={t('fin.name')}
              placeholder={t('fin.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              required
              inputMode="decimal"
              aria-label={t('fin.discountPercent')}
              placeholder={t('fin.discountPercent')}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
            <Input
              aria-label={t('fin.exemptTaxes')}
              placeholder={t('fin.exemptTaxes')}
              value={exempt}
              onChange={(e) => setExempt(e.target.value)}
            />
            <fieldset className="flex flex-wrap gap-3 sm:col-span-3">
              <legend className="sr-only">{t('fin.departments')}</legend>
              {DEPARTMENTS.map((d) => (
                <Label key={d} className="flex items-center gap-1 font-normal">
                  <Checkbox
                    checked={departments.includes(d)}
                    onCheckedChange={(v) =>
                      setDepartments(
                        v === true ? [...departments, d] : departments.filter((x) => x !== d),
                      )
                    }
                  />
                  {enumLabel('department', d)}
                </Label>
              ))}
            </fieldset>
            <Button type="submit" variant="outline" loading={act.isPending}>
              {t('fin.addProfile')}
            </Button>
          </form>
        )}
        {act.error && <Alert>{errorMessage(act.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
