'use client';

import type { Member, RoleDto } from '@hotel/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  LoadingRegion,
  NativeSelect,
  Notice,
  PageHeader,
  SectionCard,
  SkeletonRow,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserPlus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel, statusVariant } from '@/lib/status';

const ORG_SCOPE = '__organization__';

/** '' means "not chosen yet": the select shows its first option, so use that. */
function toPropertyId(scope: string, firstPropertyId: string | undefined): string | null {
  if (scope === ORG_SCOPE) return null;
  return scope || firstPropertyId || null;
}

function usePropertyNames() {
  const properties = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.properties.list({ limit: 100 }),
  });
  const items = properties.data?.items ?? [];
  const nameOf = (id: string | null) =>
    id ? (items.find((p) => p.id === id)?.name ?? '—') : t('scope.organization');
  return { items, nameOf };
}

/** Scope choices the caller may target: organization only if they hold the grant there. */
function ScopeSelect({
  value,
  onChange,
  allowOrganization,
}: {
  value: string;
  onChange: (v: string) => void;
  allowOrganization: boolean;
}) {
  const { items } = usePropertyNames();
  return (
    <NativeSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('members.scope')}
    >
      {allowOrganization && <option value={ORG_SCOPE}>{t('scope.organization')}</option>}
      {items.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}

export default function MembersPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ['members'], queryFn: api.access.members });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: api.access.roles,
    enabled: hasPermission(session.data, 'role.read'),
  });
  const { nameOf } = usePropertyNames();
  const orgAdmin = !!session.data?.grants.some(
    (g) => g.permission === 'role.assign' && g.scopeType === 'ORGANIZATION',
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members'] });
  const mutate = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: refresh,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('members.title')}
        description={
          members.data && (
            <>
              {members.data.length} {t('members.count')}
            </>
          )
        }
      />
      {hasPermission(session.data, 'member.invite') && roles.data && (
        <InviteForm roles={roles.data} allowOrganization={orgAdmin} onInvited={refresh} />
      )}
      {mutate.error && <Alert>{errorMessage(mutate.error)}</Alert>}
      {members.error && <Alert>{errorMessage(members.error)}</Alert>}
      {members.isPending && (
        <LoadingRegion label={t('loading')} className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </LoadingRegion>
      )}

      <ul className="stagger flex flex-col gap-3">
        {members.data?.map((member) => (
          <MemberRow
            key={member.membershipId}
            member={member}
            roles={roles.data ?? []}
            self={member.identityId === session.data?.identity.id}
            allowOrganization={orgAdmin}
            nameOf={nameOf}
            run={(action) => mutate.mutate(action)}
            busy={mutate.isPending}
          />
        ))}
      </ul>
    </div>
  );
}

function InviteForm({
  roles,
  allowOrganization,
  onInvited,
}: {
  roles: RoleDto[];
  allowOrganization: boolean;
  onInvited: () => void;
}) {
  const { items } = usePropertyNames();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [scope, setScope] = useState(allowOrganization ? ORG_SCOPE : '');
  const invite = useMutation({
    mutationFn: api.access.invite,
    onSuccess: () => {
      setEmail('');
      setDisplayName('');
      onInvited();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const propertyId = toPropertyId(scope, items[0]?.id);
    invite.mutate({ email, displayName, assignments: [{ roleId, propertyId }] });
  };

  return (
    <SectionCard icon={UserPlus} title={t('members.invite')}>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          {invite.error && <Alert className="sm:col-span-2">{errorMessage(invite.error)}</Alert>}
          {invite.isSuccess && <Notice className="sm:col-span-2">{t('members.invited')}</Notice>}
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-email">{t('login.email')}</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-name">{t('members.name')}</Label>
            <Input
              id="invite-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invite-role">{t('members.role')}</Label>
            <NativeSelect
              id="invite-role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t('members.scope')}</Label>
            <ScopeSelect value={scope} onChange={setScope} allowOrganization={allowOrganization} />
          </div>
          <Button type="submit" loading={invite.isPending} className="self-start">
            {t('members.send')}
          </Button>
        </form>
      </CardContent>
    </SectionCard>
  );
}

function MemberRow({
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
                    aria-label={`${t('members.remove')} ${a.roleName}`}
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
