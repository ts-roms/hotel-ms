'use client';

import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function DashboardPage() {
  const session = useSession();
  const properties = useQuery({
    queryKey: ['properties', session.data?.activeOrganizationId],
    queryFn: () => api.properties.list({ limit: 100 }),
    enabled: !!session.data?.activeOrganizationId,
  });

  const propertyNames = new Map(properties.data?.items.map((p) => [p.id, p.name]));
  const access = groupGrants(session.data?.grants ?? []);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="mb-1 text-xl font-semibold">{t('dashboard.properties')}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{t('dashboard.propertiesDescription')}</p>

        {properties.isError && <Alert>{t('error.generic')}</Alert>}
        {properties.isPending && <p className="text-muted-foreground">{t('loading')}</p>}
        {properties.data?.items.length === 0 && (
          <p className="text-muted-foreground">{t('dashboard.empty')}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.data?.items.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{p.name}</CardTitle>
                  <Badge>{p.code}</Badge>
                </div>
                <CardDescription>
                  {[p.city, p.countryCode].filter(Boolean).join(', ')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t('property.businessDate')}</dt>
                  <dd>{p.currentBusinessDate}</dd>
                  <dt className="text-muted-foreground">{t('property.timezone')}</dt>
                  <dd>{p.timezone}</dd>
                  <dt className="text-muted-foreground">{t('property.currency')}</dt>
                  <dd>{p.currency}</dd>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('dashboard.access')}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {access.map(([scope, permissions]) => (
            <li key={scope}>
              <span className="font-medium">
                {scope === 'ORGANIZATION'
                  ? t('scope.organization')
                  : (propertyNames.get(scope) ?? scope)}
              </span>
              <span className="text-muted-foreground">: {permissions.join(', ')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function groupGrants(
  grants: { permission: string; scopeType: string; propertyId: string | null }[],
) {
  const byScope = new Map<string, string[]>();
  for (const g of grants) {
    const key = g.scopeType === 'ORGANIZATION' ? 'ORGANIZATION' : g.propertyId!;
    byScope.set(key, [...(byScope.get(key) ?? []), g.permission]);
  }
  return [...byScope];
}
