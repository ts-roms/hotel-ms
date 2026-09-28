'use client';

import { Alert, Badge, EmptyState, Input, PageHeader } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

/** Global search (spec §73, ADR-0025): results limited to what the user may open. */
export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q')?.trim() ?? '';
  const [draft, setDraft] = useState(q);
  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.length >= 2,
  });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('search.title')} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/search?q=${encodeURIComponent(draft.trim())}`);
        }}
      >
        <Input
          autoFocus
          aria-label={t('search.title')}
          placeholder={t('search.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </form>
      {results.error && <Alert>{errorMessage(results.error)}</Alert>}
      {results.data?.length === 0 && <EmptyState icon={<Search />} title={t('search.none')} />}
      <div className="flex flex-col gap-2">
        {results.data?.map((r) => (
          <Link
            key={`${r.kind}:${r.id}`}
            href={r.link}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/40"
          >
            <span className="flex flex-col">
              <span className="font-medium">{r.title}</span>
              <span className="text-xs text-muted-foreground">
                {r.subtitle}
                {r.propertyName && ` · ${r.propertyName}`}
              </span>
            </span>
            <Badge>{t(`search.kind.${r.kind}` as Parameters<typeof t>[0])}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
