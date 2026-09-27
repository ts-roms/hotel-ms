'use client';

import { DEPARTMENTS, type Folio } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Notice,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatMoney, minorToInput, parseMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

/** Payments, refunds, online links, transfers, routing and documents for one folio. */
export function FolioFinance({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const session = useSession();
  const can = (p: string) => hasPermission(session.data, p);
  const open = folio.status === 'OPEN';
  return (
    <>
      {folio.payments.length > 0 && <Payments propertyId={propertyId} folio={folio} />}
      {open && can('payment.create') && <PaymentLink propertyId={propertyId} folio={folio} />}
      {open && can('folio.transfer') && <Transfers propertyId={propertyId} folio={folio} />}
      {can('invoice.issue') && <Documents propertyId={propertyId} folio={folio} />}
    </>
  );
}

function useRefreshFolio(propertyId: string, folioId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['folio', propertyId, folioId] });
}

function Payments({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const session = useSession();
  const refresh = useRefreshFolio(propertyId, folio.id);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const refund = useMutation({
    mutationFn: (paymentId: string) =>
      pms.refund(paymentId, parseMoney(amount, folio.currency)!, reason, crypto.randomUUID()),
    onSuccess: () => {
      setRefunding(null);
      setAmount('');
      setReason('');
      return refresh();
    },
  });
  const canRefund = hasPermission(session.data, 'payment.refund') && folio.status === 'OPEN';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.payments')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {refund.error && <Alert>{errorMessage(refund.error)}</Alert>}
        {folio.payments.map((p) => {
          const left = p.amountMinor - p.refundedMinor;
          return (
            <div key={p.id} className="flex flex-col gap-2 border-t pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {p.method.replace('_', ' ').toLowerCase()}
                  {p.provider && <Badge className="ml-2">{t('fin.online')}</Badge>}
                  {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(p.amountMinor, folio.currency)}</span>
                  {p.refundedMinor > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('fin.refunded')} {formatMoney(p.refundedMinor, folio.currency)}
                    </span>
                  )}
                  {canRefund && left > 0 && refunding !== p.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRefunding(p.id);
                        setAmount(minorToInput(left, folio.currency));
                      }}
                    >
                      {t('fin.refund')}
                    </Button>
                  )}
                </span>
              </div>
              {refunding === p.id && (
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    aria-label={t('folio.amount')}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <Input
                    className="min-w-40 flex-1"
                    placeholder={t('fin.reason')}
                    aria-label={t('fin.reason')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={
                      !parseMoney(amount, folio.currency) ||
                      reason.trim().length < 3 ||
                      refund.isPending
                    }
                    onClick={() => refund.mutate(p.id)}
                  >
                    {t('fin.refund')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRefunding(null)}>
                    {t('fin.cancel')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PaymentLink({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const [amount, setAmount] = useState(
    folio.balanceMinor > 0 ? minorToInput(folio.balanceMinor, folio.currency) : '',
  );
  const intents = useQuery({
    queryKey: ['intents', propertyId, folio.id],
    queryFn: () => pms.paymentIntents(folio.id),
    refetchInterval: 15_000,
  });
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      pms.paymentLink(folio.id, parseMoney(amount, folio.currency)!, crypto.randomUUID()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intents', propertyId, folio.id] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.onlinePayment')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-32"
            inputMode="decimal"
            aria-label={t('folio.amount')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!parseMoney(amount, folio.currency) || create.isPending}
            onClick={() => create.mutate()}
          >
            {t('fin.createLink')}
          </Button>
        </div>
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        {intents.data?.slice(0, 5).map((i) => (
          <div
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
          >
            <span className="tabular-nums">{formatMoney(i.amountMinor, i.currency)}</span>
            <span className="flex items-center gap-2">
              <Badge className={i.needsAttention ? 'text-destructive' : ''}>
                {i.status.toLowerCase()}
                {i.needsAttention && ` · ${t('fin.needsAttention')}`}
              </Badge>
              {i.checkoutUrl && (
                <>
                  <a className="underline" href={i.checkoutUrl} target="_blank" rel="noreferrer">
                    {t('fin.openLink')}
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void navigator.clipboard.writeText(i.checkoutUrl!)}
                  >
                    {t('fin.copyLink')}
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Transfers({ propertyId, folio }: { propertyId: string; folio: Folio }) {
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
        <Select
          aria-label={t('fin.targetAccount')}
          value={targetId}
          onChange={(e) => setTarget(e.target.value)}
        >
          {targets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.folioNo}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-1">
          {movable.map((l) => (
            <label key={l.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(l.id)}
                onChange={() =>
                  setSelected(
                    selected.includes(l.id)
                      ? selected.filter((x) => x !== l.id)
                      : [...selected, l.id],
                  )
                }
              />
              {l.description} · {formatMoney(l.amountMinor, folio.currency)}
            </label>
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
            <Select
              className="w-auto"
              aria-label={t('folio.department')}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d.toLowerCase()}
                </option>
              ))}
            </Select>
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

function Documents({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: ['documents', propertyId, folio.id],
    queryFn: () => pms.documents(folio.id),
  });
  const issue = useMutation({
    mutationFn: (body: Parameters<typeof pms.issueDocument>[1]) =>
      pms.issueDocument(folio.id, body),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['documents', propertyId, folio.id] }),
  });
  const receipted = new Set(documents.data?.filter((d) => d.paymentId).map((d) => d.paymentId));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('fin.documents')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {issue.error && <Alert>{errorMessage(issue.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={issue.isPending}
            onClick={() => issue.mutate({ type: 'INVOICE' })}
          >
            {t('fin.issueInvoice')}
          </Button>
          {folio.payments
            .filter((p) => !receipted.has(p.id))
            .map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant="outline"
                disabled={issue.isPending}
                onClick={() => issue.mutate({ type: 'RECEIPT', paymentId: p.id })}
              >
                {t('fin.receiptFor')} {formatMoney(p.amountMinor, folio.currency)}
              </Button>
            ))}
        </div>
        {documents.data?.map((d) => (
          <Link
            key={d.id}
            className="flex justify-between gap-2 border-t pt-2 underline-offset-2 hover:underline"
            href={`/p/${propertyId}/documents/${d.id}`}
          >
            <span className="font-mono">{d.documentNo}</span>
            <span className="tabular-nums">{formatMoney(d.totalMinor, d.currency)}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
