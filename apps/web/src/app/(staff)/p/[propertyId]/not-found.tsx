import { Button, EmptyState } from '@hotel/ui';
import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { t } from '@/lib/i18n';

/**
 * A property (or a record in it) the member cannot see. Rendered by the property layout for an
 * unknown or out-of-scope property, and by Next.js for `notFound()` in a property page.
 */
export default function PropertyNotFound() {
  return (
    <EmptyState
      icon={<SearchX />}
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">{t('notFound.toDashboard')}</Link>
        </Button>
      }
    />
  );
}
