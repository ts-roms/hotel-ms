'use client';

import { Avatar, CardContent, cn, Skeleton, Spinner } from '@hotel/ui';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { t } from '@/lib/i18n';
import { useSession, useSwitchOrganization } from '@/lib/session';

export default function SelectOrganizationPage() {
  const router = useRouter();
  const session = useSession();
  const switchOrg = useSwitchOrganization();
  const [choosing, setChoosing] = useState<string | null>(null);

  useEffect(() => {
    if (session.data === null) router.replace('/login');
    else if (session.data?.mfaPending) router.replace('/login/verify');
  }, [session.data, router]);

  return (
    <AuthShell
      title={t('org.select.title')}
      description={t('org.select.subtitle')}
      className="max-w-md"
    >
      <CardContent className="stagger flex flex-col gap-2">
        {!session.data &&
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        {session.data?.memberships.map((m) => {
          const active = m.organizationId === session.data?.activeOrganizationId;
          return (
            <button
              key={m.organizationId}
              type="button"
              className={cn(
                'hover-lift flex items-center gap-3 rounded-xl border bg-card p-3 text-left text-sm font-medium disabled:pointer-events-none disabled:opacity-60',
                active && 'border-primary/40 bg-primary/5',
              )}
              disabled={switchOrg.isPending}
              onClick={async () => {
                setChoosing(m.organizationId);
                const ok = await switchOrg.mutateAsync(m.organizationId).then(
                  () => true,
                  () => false,
                );
                setChoosing(null);
                if (ok) router.replace('/dashboard');
              }}
            >
              <Avatar name={m.organizationName} />
              <span className="flex-1 truncate">{m.organizationName}</span>
              {choosing === m.organizationId ? (
                <Spinner className="size-4 text-primary" />
              ) : (
                active && <Check className="size-4 text-primary" />
              )}
            </button>
          );
        })}
      </CardContent>
    </AuthShell>
  );
}
