'use client';

import { Alert, LoadingRegion, PageHeader, SkeletonRow } from '@hotel/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { hasPermission, useSession } from '@/lib/session';
import { useAction } from '@/lib/use-action';
import { InviteForm } from './_components/invite-form';
import { MemberRow } from './_components/member-row';
import { usePropertyNames } from './_components/use-property-names';

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
  const mutate = useAction({
    onSuccess: refresh,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('members.title')}
        description={members.data && t('members.countLabel', { count: members.data.length })}
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
