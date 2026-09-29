'use client';

import { type Folio } from '@hotel/contracts';
import { formatDate, formatMoney } from '@hotel/format';
import { Badge, Button, Table, TableBody, TableCell, TableRow } from '@hotel/ui';
import { t } from '@/lib/i18n';
import { enumLabel } from '@/lib/status';

/** The folio's lines, with a same-day void action on charges. */
export function FolioLinesTable({
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
  return (
    <Table>
      <TableBody className="stagger">
        {f.lines.map((line) => (
          <TableRow
            key={line.id}
            className={
              line.reversed ? 'text-muted-foreground line-through hover:bg-transparent' : undefined
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
              {canVoid &&
                line.type === 'CHARGE' &&
                !line.reversed &&
                line.businessDate === today && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:text-destructive"
                    disabled={voidBusy}
                    onClick={() => {
                      const reason = window.prompt(t('folio.voidReason'));
                      if (reason?.trim()) onVoid(line.id, reason.trim());
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
  );
}
