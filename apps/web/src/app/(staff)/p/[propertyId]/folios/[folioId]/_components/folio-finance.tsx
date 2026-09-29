'use client';

import { type Folio } from '@hotel/contracts';
import { CardHolds } from './card-holds';
import { FolioDocuments } from './folio-documents';
import { FolioPayments } from './folio-payments';
import { FolioTransfers } from './folio-transfers';
import { ForeignCash } from './foreign-cash';
import { PaymentLink } from './payment-link';
import { StatutoryDiscount } from './statutory-discount';
import { useCan } from '@/lib/property';

/** Payments, refunds, online links, transfers, routing and documents for one folio. */
export function FolioFinance({ propertyId, folio }: { propertyId: string; folio: Folio }) {
  const can = useCan();
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
