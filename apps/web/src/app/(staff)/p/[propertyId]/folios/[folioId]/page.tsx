'use client';

import { DEPARTMENTS, type Folio, PAYMENT_METHODS } from '@hotel/contracts';
import { formatDate, formatMoney, minorToInput, parseMoney } from '@hotel/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  LoadingRegion,
  NativeSelect,
  Skeleton,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, useProperty } from '@/lib/property';
import { enumLabel, statusVariant } from '@/lib/status';
import { FolioFinance } from './_components/folio-finance';

export default function FolioPage() {
  const { propertyId, folioId } = useParams<{ propertyId: string; folioId: string }>();
  const pms = usePms(propertyId);
  const can = useCan();
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

  const f = folio.data;
  if (folio.error) return <Alert>{errorMessage(folio.error)}</Alert>;
  if (!f)
    return (
      <LoadingRegion label={t('loading')} className="flex max-w-3xl flex-col gap-4">
        <Card className="p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-7 w-32 rounded-full" />
          </div>
          <SkeletonTable rows={5} columns={4} />
        </Card>
        <Card className="flex gap-2 p-6">
          <Skeleton className="h-10 flex-1 rounded-lg" />
          <Skeleton className="h-10 flex-1 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </Card>
      </LoadingRegion>
    );
  const open = f.status === 'OPEN';
  const today = property.data?.currentBusinessDate;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Receipt className="size-4" />
              </span>
              {f.label ?? t('folio.title')}
              <span className="font-mono text-sm font-normal text-muted-foreground">
                {f.folioNo}
              </span>
            </CardTitle>
            <div className="flex items-center gap-3">
              {!open && <Badge variant={statusVariant(f.status)}>{t('folio.closed')}</Badge>}
              <div className="flex flex-col items-end leading-tight">
                <span className="text-xs text-muted-foreground">{t('fd.balance')}</span>
                <strong
                  className={
                    f.balanceMinor === 0
                      ? 'text-lg tabular-nums text-success'
                      : 'text-lg tabular-nums'
                  }
                >
                  {formatMoney(f.balanceMinor, f.currency)}
                </strong>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {f.lines.length === 0 && (
            <EmptyState icon={<Receipt />} title={t('folio.noLines')} className="border-0" />
          )}
          <Table>
            <TableBody className="stagger">
              {f.lines.map((line) => (
                <TableRow
                  key={line.id}
                  className={
                    line.reversed
                      ? 'text-muted-foreground line-through hover:bg-transparent'
                      : undefined
                  }
                >
                  <TableCell className="whitespace-nowrap px-2 text-muted-foreground">
                    {formatDate(line.businessDate)}
                  </TableCell>
                  <TableCell className="px-2">
                    {line.parentLineId ? (
                      <span className="pl-4 text-muted-foreground">{line.description}</span>
                    ) : (
                      line.description
                    )}
                    {line.reason && <span className="text-muted-foreground"> · {line.reason}</span>}
                  </TableCell>
                  <TableCell className="px-2">
                    <Badge variant={line.type === 'PAYMENT' ? 'success' : 'neutral'}>
                      {enumLabel('folioLine', line.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-2 text-right font-medium tabular-nums">
                    {formatMoney(line.amountMinor, f.currency)}
                  </TableCell>
                  <TableCell className="py-1.5 pl-2 pr-0 text-right">
                    {open &&
                      can('folio.void') &&
                      line.type === 'CHARGE' &&
                      !line.reversed &&
                      line.businessDate === today && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="hover:text-destructive"
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {action.error && <Alert>{errorMessage(action.error)}</Alert>}

      {open && can('folio.post') && (
        <AmountForm
          title={t('folio.postCharge')}
          currency={f.currency}
          options={DEPARTMENTS}
          labelOf={(d) => enumLabel('department', d)}
          optionLabel={t('folio.department')}
          withDescription
          busy={action.isPending}
          onSubmit={(department, amountMinor, description) =>
            action.mutate(() =>
              pms.postCharge(
                f.id,
                {
                  department,
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
          labelOf={(m) => enumLabel('paymentMethod', m)}
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
                  method,
                  amountMinor,
                  reference: reference || null,
                },
                crypto.randomUUID(),
              ),
            )
          }
        />
      )}
      <FolioFinance propertyId={propertyId} folio={f} />
    </div>
  );
}

function AmountForm<O extends string>({
  title,
  currency,
  options,
  labelOf,
  optionLabel,
  withDescription,
  descriptionLabel,
  defaultAmount,
  busy,
  onSubmit,
}: {
  title: string;
  currency: string;
  options: readonly O[];
  /** Display label of an option. */
  labelOf: (option: O) => string;
  optionLabel: string;
  withDescription?: boolean;
  descriptionLabel?: string;
  defaultAmount?: number;
  busy: boolean;
  onSubmit: (option: O, amountMinor: number, description: string) => void;
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
          <NativeSelect
            aria-label={optionLabel}
            value={option}
            onChange={(e) => setOption(e.target.value as O)}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {labelOf(o)}
              </option>
            ))}
          </NativeSelect>
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
          <Button type="submit" variant="outline" loading={busy}>
            {title}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
