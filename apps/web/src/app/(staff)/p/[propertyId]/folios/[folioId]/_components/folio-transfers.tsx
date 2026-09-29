'use client';

import { DEPARTMENTS, type Folio } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  Notice,
  NativeSelect,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { useRefreshFolio } from './folio-cache';
import { enumLabel } from '@/lib/status';

export function FolioTransfers({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const refresh = useRefreshFolio(propertyId, folio.id);
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts', propertyId], queryFn: pms.accounts });
  const rules = useQuery({
    queryKey: ['routing', propertyId, folio.id],
    queryFn: () => pms.routingRules(folio.id),
  });
  const targets = (accounts.data ?? []).filter((a) => a.id !== folio.id && a.status === 'OPEN');
  const [target, setTarget] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [department, setDepartment] = useState<string>('ROOM');
  const targetId = target || targets[0]?.id || '';
  const movable = folio.lines.filter((l) => l.type === 'CHARGE' && !l.reversed);
  const transfer = useMutation({
    mutationFn: () => pms.transfer(folio.id, targetId, selected, t('fin.transferReason')),
    onSuccess: () => {
      setSelected([]);
      return refresh();
    },
  });
  const routing = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['routing', propertyId, folio.id] }),
  });
  if (targets.length === 0) {
    return (
      <Notice>
        {t('fin.noAccounts')}{' '}
        <Link className="underline" href={`/p/${propertyId}/accounts`}>
          {t('fin.accounts')}
        </Link>
      </Notice>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.transfers')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {(transfer.error || routing.error) && (
          <Alert>{errorMessage(transfer.error ?? routing.error)}</Alert>
        )}
        <NativeSelect
          aria-label={t('fin.targetAccount')}
          value={targetId}
          onChange={(e) => setTarget(e.target.value)}
        >
          {targets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.folioNo}
            </option>
          ))}
        </NativeSelect>
        <div className="flex flex-col gap-1">
          {movable.map((l) => (
            <Label key={l.id} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={selected.includes(l.id)}
                onCheckedChange={() =>
                  setSelected(
                    selected.includes(l.id)
                      ? selected.filter((x) => x !== l.id)
                      : [...selected, l.id],
                  )
                }
              />
              {l.description} · {formatMoney(l.amountMinor, folio.currency)}
            </Label>
          ))}
        </div>
        <Button
          variant="outline"
          disabled={selected.length === 0 || transfer.isPending}
          onClick={() => transfer.mutate()}
        >
          {t('fin.moveCharges')}
        </Button>
        <div className="flex flex-col gap-2 border-t pt-3">
          <span className="font-medium">{t('fin.routing')}</span>
          {rules.data?.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <span>
                {r.departments.join(', ')} → {r.targetLabel ?? r.targetFolioNo}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => routing.mutate(() => pms.removeRoutingRule(r.id))}
              >
                {t('fin.remove')}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              className="w-auto"
              aria-label={t('folio.department')}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {enumLabel('department', d)}
                </option>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              disabled={routing.isPending}
              onClick={() =>
                routing.mutate(() => pms.addRoutingRule(folio.id, targetId, [department]))
              }
            >
              {t('fin.addRouting')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
