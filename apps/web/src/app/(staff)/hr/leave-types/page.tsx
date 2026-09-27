'use client';

import type { LeaveType } from '@hotel/contracts';
import { Alert, Badge, Button, Card, CardContent, Input, Label, PageHeader } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

/** Leave types: monthly accrual and the approval chain (blueprint §13.4, ADR-0017). */
export default function LeaveTypesPage() {
  const types = useQuery({ queryKey: ['leave-types'], queryFn: api.hr.leaveTypes });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={t('hr.leaveTypes')} />
      {types.error && <Alert>{errorMessage(types.error)}</Alert>}
      <div className="flex flex-col gap-3">
        {types.data?.map((type) => (
          <LeaveTypeRow key={type.id} type={type} />
        ))}
      </div>
    </div>
  );
}

function LeaveTypeRow({ type }: { type: LeaveType }) {
  const queryClient = useQueryClient();
  const [accrual, setAccrual] = useState(String(type.accrualDaysPerMonth));
  const [notice, setNotice] = useState(String(type.minNoticeDays));
  const [hr, setHr] = useState(type.hrApprovalRequired);
  const [paid, setPaid] = useState(type.paid);
  const save = useMutation({
    mutationFn: () =>
      api.hr.updateLeaveType(type.id, {
        accrualDaysPerMonth: Number(accrual),
        minNoticeDays: Number(notice),
        hrApprovalRequired: hr,
        paid,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave-types'] }),
  });
  const changed =
    Number(accrual) !== type.accrualDaysPerMonth ||
    Number(notice) !== type.minNoticeDays ||
    hr !== type.hrApprovalRequired ||
    paid !== type.paid;
  const id = (name: string) => `${type.id}-${name}`;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{type.name}</span>
          <Badge variant="outline" className="font-mono">
            {type.code}
          </Badge>
          {type.archived && <Badge>archived</Badge>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={id('accrual')}>{t('hr.accrualPerMonth')}</Label>
            <Input
              id={id('accrual')}
              type="number"
              step="0.5"
              min="0"
              max="10"
              value={accrual}
              onChange={(e) => setAccrual(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={id('notice')}>{t('hr.minNotice')}</Label>
            <Input
              id={id('notice')}
              type="number"
              min="0"
              max="365"
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hr} onChange={(e) => setHr(e.target.checked)} />
          {t('hr.hrApproval')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          {t('hr.paidLeave')}
        </label>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Button
          className="self-start"
          size="sm"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate()}
        >
          {t('hr.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
