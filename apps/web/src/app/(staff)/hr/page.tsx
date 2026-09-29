'use client';

import { redirect } from 'next/navigation';
import { PageSkeleton } from '@/components/staff-shell/shell-skeleton';
import { canOpen, firstOrgPage, ORG_NAV } from '@/lib/nav';
import { useSession } from '@/lib/session';

const EMPLOYEES = ORG_NAV.find((i) => i.href === '/hr/employees')!;

/** /hr has no page of its own: open the employee list, else the first HR page the member may. */
export default function HrIndex() {
  const session = useSession();
  if (session.isPending) return <PageSkeleton />;
  const info = session.data;
  redirect(
    canOpen(info, EMPLOYEES) ? EMPLOYEES.href : (firstOrgPage(info, '/hr/') ?? '/dashboard'),
  );
}
