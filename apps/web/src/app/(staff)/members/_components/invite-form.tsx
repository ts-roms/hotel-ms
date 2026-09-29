'use client';

import type { RoleDto } from '@hotel/contracts';
import {
  Alert,
  Button,
  CardContent,
  Input,
  Label,
  NativeSelect,
  Notice,
  SectionCard,
} from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { ORG_SCOPE, toPropertyId } from './scope';
import { ScopeSelect } from './scope-select';
import { usePropertyNames } from './use-property-names';

export function InviteForm({
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
