'use client';

import { Avatar, Button, CardContent, cn, Skeleton, Spinner } from '@hotel/ui';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/auth-shell';
import { t } from '@/lib/i18n';
import { useSession, useSwitchOrganization } from '@/lib/session';

/**
 * Unlike the other screens in `(auth)`, this one is signed in: the identity has passed login
 * (and MFA) but has no active organization yet, so it cannot enter the `(staff)` shell. It
 * shares the sign-in backdrop because it is the last step before the shell, not part of it.
 */
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
    <AuthCard
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
            <Button
              key={m.organizationId}
              type="button"
              variant="outline"
              className={cn(
                'hover-lift h-auto justify-start gap-3 rounded-xl p-3 text-left text-foreground disabled:opacity-60',
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
            </Button>
          );
        })}
      </CardContent>
    </AuthCard>
  );
}
