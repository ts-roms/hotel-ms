'use client';

import { formatDate, formatDateTime, formatMoney } from '@hotel/format';
import { Alert, Button, Table, TableBody, TableCell, TableRow } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';

/** Printable invoice or receipt, rendered from its frozen snapshot. */
export default function DocumentPage() {
  const { propertyId, documentId } = useParams<{ propertyId: string; documentId: string }>();
  const pms = usePms(propertyId);
  const document = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => pms.document(documentId),
  });
  const d = document.data;
  if (document.error) return <Alert>{errorMessage(document.error)}</Alert>;
  if (!d) return <p className="text-muted-foreground">{t('loading')}</p>;
  const money = (v: number) => formatMoney(v, d.currency);
  const c = d.content;
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-4 rounded-md border bg-card p-6 text-sm print:border-0">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">{c.property.name}</div>
          {c.property.address && <div className="text-muted-foreground">{c.property.address}</div>}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">
            {d.type === 'INVOICE' ? t('fin.invoice') : t('fin.receipt')}
          </div>
          <div className="font-mono">{d.documentNo}</div>
          <div className="text-muted-foreground">{formatDateTime(d.issuedAt)}</div>
        </div>
      </header>
      <div>
        {t('fin.billTo')}: <strong>{c.billTo}</strong> · {t('folio.title')} {c.folioNo}
      </div>
      {c.payment ? (
        <div className="flex justify-between border-y py-2">
          <span>
            {c.payment.method.toLowerCase().replace('_', ' ')}
            {c.payment.reference && ` · ${c.payment.reference}`}
          </span>
          <strong className="tabular-nums">{money(c.payment.amountMinor)}</strong>
        </div>
      ) : (
        <Table className="border-t">
          <TableBody>
            {c.lines.map((l, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                <TableCell className="whitespace-nowrap py-1 pl-0 pr-2">
                  {formatDate(l.date)}
                </TableCell>
                <TableCell className="py-1 pl-0 pr-2">{l.description}</TableCell>
                <TableCell className="py-1 pl-0 pr-0 text-right tabular-nums">
                  {money(l.amountMinor)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="ml-auto flex w-64 flex-col gap-1">
        {c.taxes.map((tax) => (
          <div key={tax.code} className="flex justify-between text-muted-foreground">
            <span>{tax.name}</span>
            <span className="tabular-nums">{money(tax.amountMinor)}</span>
          </div>
        ))}
        <div className="flex justify-between">
          <span>{t('fin.charges')}</span>
          <span className="tabular-nums">{money(c.totals.chargesMinor)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('fin.paid')}</span>
          <span className="tabular-nums">{money(c.totals.paymentsMinor)}</span>
        </div>
        <div className="flex justify-between border-t pt-1 font-semibold">
          <span>{t('fd.balance')}</span>
          <span className="tabular-nums">{money(c.totals.balanceMinor)}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('fin.notOfficial')}</p>
      <Button className="self-start print:hidden" variant="outline" onClick={() => window.print()}>
        {t('fin.print')}
      </Button>
    </article>
  );
}
