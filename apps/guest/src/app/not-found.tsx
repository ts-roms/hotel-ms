import { buttonVariants, CardContent } from '@hotel/ui';
import Link from 'next/link';
import { GuestShell } from '@/components/guest-shell';
import { t } from '@/lib/i18n';

/** Any URL the guest portal does not know. */
export default function NotFound() {
  return (
    <GuestShell title={t('notFound.title')} description={t('notFound.description')}>
      <CardContent className="flex justify-center">
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          {t('notFound.home')}
        </Link>
      </CardContent>
    </GuestShell>
  );
}
