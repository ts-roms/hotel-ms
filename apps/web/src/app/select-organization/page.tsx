'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hotel/ui';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { t } from '@/lib/i18n';
import { useSession, useSwitchOrganization } from '@/lib/session';

export default function SelectOrganizationPage() {
  const router = useRouter();
  const session = useSession();
  const switchOrg = useSwitchOrganization();

  useEffect(() => {
    if (session.data === null) router.replace('/login');
    else if (session.data?.mfaPending) router.replace('/login/verify');
  }, [session.data, router]);

  if (!session.data) return <p className="p-6 text-muted-foreground">{t('loading')}</p>;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('org.select.title')}</CardTitle>
          <CardDescription>{t('org.select.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {session.data.memberships.map((m) => (
            <Button
              key={m.organizationId}
              variant={
                m.organizationId === session.data?.activeOrganizationId ? 'default' : 'outline'
              }
              className="justify-start"
              disabled={switchOrg.isPending}
              onClick={async () => {
                await switchOrg.mutateAsync(m.organizationId);
                router.replace('/dashboard');
              }}
            >
              {m.organizationName}
            </Button>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
