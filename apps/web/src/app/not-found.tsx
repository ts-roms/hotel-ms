import { Button, DocumentTitle, EmptyState } from '@hotel/ui';
import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { t } from '@/lib/i18n';

/** Any URL the app does not know (outside the staff shell, which has its own). */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <DocumentTitle title={t('notFound.title')} />
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
    </main>
  );
}
