'use client';

import { type Folio } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';

export function FolioDocuments({ propertyId, folio }: { propertyId: string; folio: Folio }) {
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
                {t('fin.receiptForAmount', { amount: formatMoney(p.amountMinor, folio.currency) })}
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
