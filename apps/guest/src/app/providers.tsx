'use client';

import { createQueryClient, useRequestsInFlight } from '@hotel/api-client/react';
import { DocumentTitleProvider, TopProgress } from '@hotel/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { t } from '@/lib/i18n';

/** Browser tab titles: "<page> · <app name>". */
const pageTitle = (page: string) =>
  page === t('app.name') ? page : t('app.pageTitle', { page, app: t('app.name') });

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <DocumentTitleProvider format={pageTitle}>
        <RequestProgress />
        {children}
      </DocumentTitleProvider>
    </QueryClientProvider>
  );
}

function RequestProgress() {
  return <TopProgress busy={useRequestsInFlight()} />;
}
