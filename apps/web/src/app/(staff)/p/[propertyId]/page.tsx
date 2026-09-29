'use client';

import { redirect } from 'next/navigation';
import { PageSkeleton } from '@/components/staff-shell/shell-skeleton';
import { firstPropertyPage } from '@/lib/nav';
import { usePropertyId } from '@/lib/property';
import { useSession } from '@/lib/session';
import PropertyNotFound from './not-found';

/** /p/[propertyId] has no page of its own: open the first page the member may use there. */
export default function PropertyIndex() {
  const propertyId = usePropertyId();
  const session = useSession();
  if (session.isPending) return <PageSkeleton />;
  const page = firstPropertyPage(session.data, propertyId);
  if (!page) return <PropertyNotFound />;
  redirect(`/p/${propertyId}/${page}`);
}
