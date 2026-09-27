'use client';

import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

/**
 * Read-only role catalog. Creating and editing roles is available through the API
 * (POST/PATCH /roles); the editor UI comes with the next access iteration.
 */
export default function RolesPage() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: api.access.roles });
  const permissions = useQuery({ queryKey: ['permissions'], queryFn: api.access.permissions });
  const describe = (code: string) =>
    permissions.data?.find((p) => p.code === code)?.description ?? code;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('roles.title')}</h1>
      {roles.error && <Alert>{errorMessage(roles.error)}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        {roles.data?.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle>{role.name}</CardTitle>
                <Badge>
                  {role.assignmentCount} {t('roles.members')}
                </Badge>
              </div>
              {role.description && <CardDescription>{role.description}</CardDescription>}
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {role.permissions.map((code) => (
                  <li key={code}>
                    <span className="font-mono text-xs text-muted-foreground">{code}</span>{' '}
                    {describe(code)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
