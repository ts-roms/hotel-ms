'use client';

import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LoadingRegion,
  PageHeader,
  SkeletonCard,
} from '@hotel/ui';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Users } from 'lucide-react';
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
      <PageHeader title={t('roles.title')} />
      {roles.error && <Alert>{errorMessage(roles.error)}</Alert>}
      {roles.isPending && (
        <LoadingRegion label={t('loading')} className="grid gap-4 md:grid-cols-2">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </LoadingRegion>
      )}
      <div className="stagger grid gap-4 md:grid-cols-2">
        {roles.data?.map((role) => (
          <Card key={role.id} className="hover-lift">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheck className="size-4" />
                  </span>
                  <CardTitle className="text-base">{role.name}</CardTitle>
                </div>
                <Badge variant="primary">
                  <Users />
                  {t('roles.memberCount', { count: role.assignmentCount })}
                </Badge>
              </div>
              {role.description && <CardDescription>{role.description}</CardDescription>}
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5 text-sm">
                {role.permissions.map((code) => (
                  <li key={code} className="flex flex-wrap items-baseline gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {code}
                    </code>
                    <span>{describe(code)}</span>
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
