'use client';

import { DEPARTMENTS, type Folio, PAYMENT_METHODS } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMoney, minorToInput, parseMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePms, useProperty } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

export default function FolioPage() {
  const { propertyId, folioId } = useParams<{ propertyId: string; folioId: string }>();
  const pms = usePms(propertyId);
  const session = useSession();
  const property = useProperty(propertyId);
  const queryClient = useQueryClient();
  const folio = useQuery({
    queryKey: ['folio', propertyId, folioId],
    queryFn: () => pms.folio(folioId),
  });
  const action = useMutation({
    mutationFn: (fn: () => Promise<Folio>) => fn(),
    onSuccess: (data) => queryClient.setQueryData(['folio', propertyId, folioId], data),
  });
  const can = (p: string) => hasPermission(session.data, p);

  const f = folio.data;
  if (folio.error) return <Alert>{errorMessage(folio.error)}</Alert>;
  if (!f) return <p className="text-muted-foreground">{t('loading')}</p>;
  const open = f.status === 'OPEN';
  const today = property.data?.currentBusinessDate;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {t('folio.title')}{' '}
              <span className="font-mono text-sm text-muted-foreground">{f.folioNo}</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              {!open && <Badge>{t('folio.closed')}</Badge>}
              <strong>
                {t('fd.balance')}: {formatMoney(f.balanceMinor, f.currency)}
              </strong>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {f.lines.map((line) => (
                <tr
                  key={line.id}
                  className={line.reversed ? 'text-muted-foreground line-through' : ''}
                >
                  <td className="whitespace-nowrap py-1 pr-2">{formatDate(line.businessDate)}</td>
                  <td className="py-1 pr-2">
                    {line.parentLineId ? (
                      <span className="pl-4 text-muted-foreground">{line.description}</span>
                    ) : (
                      line.description
                    )}
                    {line.reason && <span className="text-muted-foreground"> · {line.reason}</span>}
                  </td>
                  <td className="py-1 pr-2 text-xs text-muted-foreground">
                    {line.type.toLowerCase()}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">
                    {formatMoney(line.amountMinor, f.currency)}
                  </td>
                  <td className="py-1 pl-2 text-right">
                    {open &&
                      can('folio.void') &&
                      line.type === 'CHARGE' &&
                      !line.reversed &&
                      line.businessDate === today && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={action.isPending}
                          onClick={() => {
                            const reason = window.prompt(t('folio.voidReason'));
                            if (reason?.trim())
                              action.mutate(() => pms.voidLine(f.id, line.id, reason.trim()));
                          }}
                        >
                          {t('folio.void')}
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {action.error && <Alert>{errorMessage(action.error)}</Alert>}

      {open && can('folio.post') && (
        <AmountForm
          title={t('folio.postCharge')}
          currency={f.currency}
          options={DEPARTMENTS}
          optionLabel={t('folio.department')}
          withDescription
          busy={action.isPending}
          onSubmit={(department, amountMinor, description) =>
            action.mutate(() =>
              pms.postCharge(
                f.id,
                {
                  department: department as (typeof DEPARTMENTS)[number],
                  description,
                  amountMinor,
                },
                crypto.randomUUID(),
              ),
            )
          }
        />
      )}
      {open && can('payment.create') && (
        <AmountForm
          title={t('folio.recordPayment')}
          currency={f.currency}
          options={PAYMENT_METHODS}
          optionLabel={t('folio.method')}
          descriptionLabel={t('folio.reference')}
          withDescription
          defaultAmount={f.balanceMinor > 0 ? f.balanceMinor : undefined}
          busy={action.isPending}
          onSubmit={(method, amountMinor, reference) =>
            action.mutate(() =>
              pms.recordPayment(
                f.id,
                {
                  method: method as (typeof PAYMENT_METHODS)[number],
                  amountMinor,
                  reference: reference || null,
                },
                crypto.randomUUID(),
              ),
            )
          }
        />
      )}
    </div>
  );
}

function AmountForm({
  title,
  currency,
  options,
  optionLabel,
  withDescription,
  descriptionLabel,
  defaultAmount,
  busy,
  onSubmit,
}: {
  title: string;
  currency: string;
  options: readonly string[];
  optionLabel: string;
  withDescription?: boolean;
  descriptionLabel?: string;
  defaultAmount?: number;
  busy: boolean;
  onSubmit: (option: string, amountMinor: number, description: string) => void;
}) {
  const [option, setOption] = useState(options[0]!);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(defaultAmount ? minorToInput(defaultAmount, currency) : '');
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = parseMoney(amount, currency);
    if (!minor) return setInvalid(true);
    setInvalid(false);
    onSubmit(option, minor, description.trim());
    setAmount('');
    setDescription('');
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-4">
          {invalid && <Alert className="sm:col-span-4">{t('folio.invalidAmount')}</Alert>}
          <Select
            aria-label={optionLabel}
            value={option}
            onChange={(e) => setOption(e.target.value)}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {o.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </Select>
          {withDescription && (
            <Input
              aria-label={descriptionLabel ?? t('folio.description')}
              placeholder={descriptionLabel ?? t('folio.description')}
              required={!descriptionLabel}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
          <Input
            aria-label={t('folio.amount')}
            placeholder={t('folio.amount')}
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={busy}>
            {title}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
