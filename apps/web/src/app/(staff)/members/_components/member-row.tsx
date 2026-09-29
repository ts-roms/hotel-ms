'use client';

import type { Member, RoleDto } from '@hotel/contracts';
import { Avatar, Badge, Button, Card, CardContent, NativeSelect } from '@hotel/ui';
import { ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';
import { ORG_SCOPE, toPropertyId } from './scope';
import { ScopeSelect } from './scope-select';
import { usePropertyNames } from './use-property-names';

export function MemberRow({
  member,
  roles,
  self,
  allowOrganization,
  nameOf,
  run,
  busy,
}: {
  member: Member;
  roles: RoleDto[];
  self: boolean;
  allowOrganization: boolean;
  nameOf: (id: string | null) => string;
  run: (action: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const session = useSession();
  const { items } = usePropertyNames();
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [scope, setScope] = useState(allowOrganization ? ORG_SCOPE : '');
  const canAssign = hasPermission(session.data, 'role.assign');

  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar name={member.displayName} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{member.displayName}</span>
              <span className="truncate text-sm text-muted-foreground">{member.email}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={statusVariant(member.status)} dot>
                {statusLabel(member.status)}
              </Badge>
              {member.mfaEnabled && (
                <Badge variant="success">
                  <ShieldCheck />
                  {t('members.mfa')}
                </Badge>
              )}
            </div>
          </div>
          <ul className="flex flex-wrap gap-2 text-sm">
            {member.assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-1 rounded-full border bg-muted/50 py-1 pl-3 pr-2 text-xs"
              >
                {a.roleName} · {nameOf(a.propertyId)}
                {canAssign && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-1 size-auto rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3"
                    aria-label={t('members.removeRole', { role: a.roleName })}
                    disabled={busy}
                    onClick={() =>
                      run(() => api.access.removeAssignment(member.membershipId, a.id))
                    }
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {canAssign && roles.length > 0 && (
              <>
                <NativeSelect
                  className="w-auto"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  aria-label={t('members.role')}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
                <div className="w-auto">
                  <ScopeSelect
                    value={scope}
                    onChange={setScope}
                    allowOrganization={allowOrganization}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api.access.addAssignment(member.membershipId, {
                        roleId,
                        propertyId: toPropertyId(scope, items[0]?.id),
                      }),
                    )
                  }
                >
                  {t('members.addRole')}
                </Button>
              </>
            )}
            {member.status === 'INVITED' && hasPermission(session.data, 'member.invite') && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => api.access.resendInvitation(member.membershipId))}
              >
                {t('members.resend')}
              </Button>
            )}
            {!self &&
              hasPermission(session.data, 'member.update') &&
              member.status !== 'INVITED' && (
                <Button
                  size="sm"
                  variant={member.status === 'ACTIVE' ? 'destructive' : 'outline'}
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api.access.updateMember(member.membershipId, {
                        status: member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                      }),
                    )
                  }
                >
                  {member.status === 'ACTIVE' ? t('members.suspend') : t('members.reactivate')}
                </Button>
              )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
