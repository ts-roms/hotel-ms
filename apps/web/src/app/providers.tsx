'use client';

import { createQueryClient, useRequestsInFlight } from '@hotel/api-client/react';
import { TopProgress } from '@hotel/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RequestProgress />
      {children}
    </QueryClientProvider>
  );
}

function RequestProgress() {
  return <TopProgress busy={useRequestsInFlight()} />;
}
