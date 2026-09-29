'use client';

import { EMPLOYMENT_TYPES, type Employee } from '@hotel/contracts';
import { Alert, Button, Input, Label, NativeSelect } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { statusLabel } from '@/lib/status';
import { RecordSection } from './record-section';

/** Employment type (employee.manage) and emergency contact (personal details). */
export function EmploymentDetails({
  employee: e,
  canManage,
}: {
  employee: Employee;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const contact = e.personal?.emergencyContact ?? null;
  const [type, setType] = useState(e.employmentType);
  const [name, setName] = useState(contact?.name ?? '');
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.hr.updateEmployee(e.id, e.version, {
        employmentType: type,
        ...(e.personal
          ? {
              personal: {
                emergencyContact: name.trim()
                  ? { name: name.trim(), relationship: relationship.trim(), phone: phone.trim() }
                  : null,
              },
            }
          : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['employee', e.id], data);
      setEditing(false);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <RecordSection icon={<UserRound />} title={t('hrx.employment')}>
      {!editing ? (
        <>
          <p>
            {t('hrx.employmentType')}: <strong>{statusLabel(e.employmentType)}</strong>
          </p>
          {e.personal ? (
            <p>
              {t('hrx.emergencyContact')}:{' '}
              {contact ? (
                <strong>
                  {contact.name}
                  {contact.relationship && ` (${contact.relationship})`} · {contact.phone}
                </strong>
              ) : (
                <span className="text-muted-foreground">{t('hrx.none')}</span>
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">{t('hr.personalHidden')}</p>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setEditing(true)}
            >
              {t('hrx.edit')}
            </Button>
          )}
        </>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Label className="flex flex-col gap-1">
            {t('hrx.employmentType')}
            <NativeSelect value={type} onChange={(ev) => setType(ev.target.value as typeof type)}>
              {EMPLOYMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {statusLabel(x)}
                </option>
              ))}
            </NativeSelect>
          </Label>
          {e.personal && (
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-1 font-medium">{t('hrx.emergencyContact')}</legend>
              <Input
                aria-label={t('hrx.contactName')}
                placeholder={t('hrx.contactName')}
                maxLength={120}
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
              <Input
                aria-label={t('hrx.relationship')}
                placeholder={t('hrx.relationship')}
                maxLength={60}
                value={relationship}
                onChange={(ev) => setRelationship(ev.target.value)}
              />
              <Input
                aria-label={t('hrx.phone')}
                placeholder={t('hrx.phone')}
                maxLength={40}
                required={!!name.trim()}
                value={phone}
                onChange={(ev) => setPhone(ev.target.value)}
              />
            </fieldset>
          )}
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              {t('hrx.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('fin.cancel')}
            </Button>
          </div>
        </form>
      )}
    </RecordSection>
  );
}
