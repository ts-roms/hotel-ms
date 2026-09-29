'use client';

import { DEPARTMENTS, type Folio, PAYMENT_METHODS } from '@hotel/contracts';
import { Alert, DocumentTitle } from '@hotel/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useCan, usePms, useProperty } from '@/lib/property';
import { enumLabel } from '@/lib/status';
import { AmountForm } from './_components/amount-form';
import { FolioFinance } from './_components/folio-finance';
import { FolioLinesCard } from './_components/folio-lines-card';
import { FolioSkeleton } from './_components/folio-skeleton';
import { useAction } from '@/lib/use-action';

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
  const action = useAction<Folio>({
    onSuccess: (data) => queryClient.setQueryData(['folio', propertyId, folioId], data),
  });

  const f = folio.data;
  if (folio.error) return <Alert>{errorMessage(folio.error)}</Alert>;
  if (!f) return <FolioSkeleton />;
  const open = f.status === 'OPEN';
  const today = property.data?.currentBusinessDate;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <DocumentTitle title={f.label ?? t('folio.title')} />
      <FolioLinesCard
        folio={f}
        canVoid={open && can('folio.void')}
        today={today}
        voidBusy={action.isPending}
        onVoid={(lineId, reason) => action.mutate(() => pms.voidLine(f.id, lineId, reason))}
      />

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
