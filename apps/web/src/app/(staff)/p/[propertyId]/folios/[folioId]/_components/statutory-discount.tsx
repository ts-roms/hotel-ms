'use client';

import type { Folio } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
} from '@hotel/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { useSetFolio } from './folio-cache';

/** Senior citizen / PWD discount on the folio: the holder's ID is stored encrypted. */
export function StatutoryDiscount({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const setFolio = useSetFolio(propertyId, folio.id);
  const profiles = useQuery({
    queryKey: ['discount-profiles', propertyId],
    queryFn: pms.discountProfiles,
  });
  const active = (profiles.data ?? []).filter((p) => p.active);
  const [profileId, setProfileId] = useState('');
  const [holderName, setHolderName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const chosen = profileId || active[0]?.id || '';
  const change = useMutation({
    mutationFn: (fn: () => Promise<Folio>) => fn(),
    onSuccess: (data) => {
      setHolderName('');
      setIdNumber('');
      setFolio(data);
    },
  });
  if (!folio.discount && active.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.discount')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {folio.discount ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <Badge variant="success">{folio.discount.name}</Badge> {folio.discount.holderName} ·
              ID ••••{folio.discount.idLast4}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={change.isPending}
              onClick={() => change.mutate(() => pms.removeDiscount(folio.id))}
            >
              {t('fin.remove')}
            </Button>
          </div>
        ) : (
          <form
            className="grid gap-2 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate(() =>
                pms.applyDiscount(folio.id, {
                  profileId: chosen,
                  holderName: holderName.trim(),
                  idNumber: idNumber.trim(),
                }),
              );
            }}
          >
            <NativeSelect
              aria-label={t('fin.discount')}
              value={chosen}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.discountPercent}%)
                </option>
              ))}
            </NativeSelect>
            <Input
              required
              aria-label={t('fin.discountHolder')}
              placeholder={t('fin.discountHolder')}
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
            />
            <Input
              required
              autoComplete="off"
              aria-label={t('fin.discountId')}
              placeholder={t('fin.discountId')}
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
            />
            <Button type="submit" variant="outline" loading={change.isPending}>
              {t('fin.applyDiscount')}
            </Button>
            <p className="text-xs text-muted-foreground sm:col-span-4">{t('fin.discountNote')}</p>
          </form>
        )}
        {change.error && <Alert>{errorMessage(change.error)}</Alert>}
      </CardContent>
    </Card>
  );
}
