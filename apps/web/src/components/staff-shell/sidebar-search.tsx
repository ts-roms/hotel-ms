'use client';

import { Input } from '@hotel/ui';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

/** Global search box; submits to /search once the query has two characters. */
export function SidebarSearch({ onSearch }: { onSearch?: () => void }) {
  const router = useRouter();
  return (
    <form
      role="search"
      className="relative mb-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get('q')?.toString().trim() ?? '';
        if (q.length >= 2) {
          onSearch?.();
          router.push(`/search?q=${encodeURIComponent(q)}`);
        }
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        name="q"
        aria-label={t('search.title')}
        placeholder={t('search.placeholder')}
        className="h-9 bg-background pl-8 pr-2"
      />
    </form>
  );
}
