'use client';

import { type Folio } from '@hotel/contracts';
import { hasPermission, useSession } from '@/lib/session';
import { CardHolds } from './card-holds';
import { FolioDocuments } from './folio-documents';
import { FolioPayments } from './folio-payments';
import { FolioTransfers } from './folio-transfers';
import { ForeignCash } from './foreign-cash';
import { PaymentLink } from './payment-link';
import { StatutoryDiscount } from './statutory-discount';

/** Payments, refunds, online links, transfers, routing and documents for one folio. */
export function FolioFinance({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const session = useSession();
  const can = (p: string) => hasPermission(session.data, p);
  const open = folio.status === 'OPEN';
  return (
    <>
      {folio.payments.length > 0 && <FolioPayments propertyId={propertyId} folio={folio} />}
      {(open || folio.discount) && can('folio.discount') && (
        <StatutoryDiscount propertyId={propertyId} folio={folio} />
      )}
      {open && can('payment.create') && <ForeignCash propertyId={propertyId} folio={folio} />}
      {can('payment.create') && <CardHolds propertyId={propertyId} folio={folio} />}
      {open && can('payment.create') && <PaymentLink propertyId={propertyId} folio={folio} />}
      {open && can('folio.transfer') && <FolioTransfers propertyId={propertyId} folio={folio} />}
      {can('invoice.issue') && <FolioDocuments propertyId={propertyId} folio={folio} />}
    </>
  );
}
