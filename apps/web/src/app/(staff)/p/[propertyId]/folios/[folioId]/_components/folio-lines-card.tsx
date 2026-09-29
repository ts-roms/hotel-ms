'use client';

import { type Folio } from '@hotel/contracts';
import { formatMoney } from '@hotel/format';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@hotel/ui';
import { Receipt } from 'lucide-react';
import { t } from '@/lib/i18n';
import { statusVariant } from '@/lib/status';
import { FolioLinesTable } from './folio-lines-table';

/** The folio header (number, status, balance) and its lines. */
export function FolioLinesCard({
  folio: f,
  canVoid,
  today,
  voidBusy,
  onVoid,
}: {
  folio: Folio;
  /** The folio is open and the user may void lines. */
  canVoid: boolean;
  today: string | undefined;
  voidBusy: boolean;
  onVoid: (lineId: string, reason: string) => void;
}) {
  const open = f.status === 'OPEN';
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Receipt className="size-4" />
            </span>
            {f.label ?? t('folio.title')}
            <span className="font-mono text-sm font-normal text-muted-foreground">{f.folioNo}</span>
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
        <FolioLinesTable
          folio={f}
          canVoid={canVoid}
          today={today}
          voidBusy={voidBusy}
          onVoid={onVoid}
        />
      </CardContent>
    </Card>
  );
}
