'use client';

import { formatMoney } from '@hotel/format';
import { Alert, Badge, Button, Card, CardContent, Input } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useProperty, usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

/** Company and group accounts (city ledger): folios without a stay. */
export default function AccountsPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const property = useProperty(propertyId);
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts', propertyId], queryFn: pms.accounts });
  const [label, setLabel] = useState('');
  const create = useMutation({
    mutationFn: () => pms.createAccount(label.trim()),
    onSuccess: () => {
      setLabel('');
      return queryClient.invalidateQueries({ queryKey: ['accounts', propertyId] });
    },
  });
  const currency = property.data?.currency ?? 'PHP';
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('fin.accounts')}</h1>
      {(accounts.error || create.error) && (
        <Alert>{errorMessage(accounts.error ?? create.error)}</Alert>
      )}
      {hasPermission(session.data, 'folio.transfer') && (
        <Card>
          <CardContent className="flex flex-wrap gap-2 pt-4">
            <Input
              className="min-w-48 flex-1"
              placeholder={t('fin.accountName')}
              aria-label={t('fin.accountName')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button disabled={!label.trim() || create.isPending} onClick={() => create.mutate()}>
              {t('fin.addAccount')}
            </Button>
          </CardContent>
        </Card>
      )}
      {accounts.data?.length === 0 && (
        <p className="text-muted-foreground">{t('fin.noAccountsYet')}</p>
      )}
      {accounts.data?.map((a) => (
        <Link
          key={a.id}
          href={`/p/${propertyId}/folios/${a.id}`}
          className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm hover:bg-accent"
        >
          <span>
            {a.label} <span className="font-mono text-xs text-muted-foreground">{a.folioNo}</span>
          </span>
          <span className="flex items-center gap-2">
            {a.status === 'CLOSED' && <Badge>{a.status.toLowerCase()}</Badge>}
            <span className="tabular-nums">{formatMoney(a.balanceMinor, currency)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
