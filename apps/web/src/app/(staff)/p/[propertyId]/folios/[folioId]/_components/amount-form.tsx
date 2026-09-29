'use client';

import { minorToInput, parseMoney } from '@hotel/format';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
} from '@hotel/ui';
import { type FormEvent, useState } from 'react';
import { t } from '@/lib/i18n';

export function AmountForm<O extends string>({
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
