'use client';

import type { PunchType } from '@hotel/contracts';
import { formatDate, localDate } from '@hotel/format';
import { Alert, Button, CardContent, SectionCard } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Timer } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { clock, PUNCH_LABEL, PUNCH_NEXT } from '@/lib/hr';
import { t } from '@/lib/i18n';
import { SelfiePunch } from './selfie-punch';

export function TimeClock() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me', 'employee'], queryFn: api.me.employee });
  // A punch needs a selfie taken now (ADR-0022): the button opens the camera first.
  const [pending, setPending] = useState<{ propertyId: string; type: PunchType } | null>(null);
  const punch = useMutation({
    mutationFn: (input: { propertyId: string; type: PunchType; selfie: Blob }) =>
      api.pms(input.propertyId).punch(input.type, input.selfie),
    onSuccess: () => {
      setPending(null);
      return queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const employee = me.data?.employee;
  if (!employee) return null;
  const last = me.data?.lastPunch;
  const state = last?.type ?? 'NONE';
  return (
    <SectionCard icon={Timer} title={t('hr.clock')}>
      <CardContent className="flex flex-col gap-3 text-sm">
        {punch.error && <Alert>{errorMessage(punch.error)}</Alert>}
        <p className="flex items-center gap-2 text-muted-foreground">
          <span
            aria-hidden="true"
            className={
              state === 'IN' || state === 'BREAK_END'
                ? 'size-2 animate-pulse rounded-full bg-success'
                : 'size-2 rounded-full bg-muted-foreground/40'
            }
          />
          {last
            ? `${t(PUNCH_LABEL[last.type])} · ${formatDate(localDate(last.at))} ${clock(last.at)}`
            : t('hr.noPunches')}
        </p>
        {employee.assignments.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <span className="min-w-40 font-medium">{a.propertyName}</span>
            {PUNCH_NEXT[state]!.map((type) => (
              <Button
                key={type}
                size="sm"
                variant={type === 'IN' || type === 'OUT' ? 'default' : 'outline'}
                disabled={punch.isPending || pending !== null}
                onClick={() => {
                  punch.reset();
                  setPending({ propertyId: a.propertyId, type });
                }}
              >
                {t(PUNCH_LABEL[type])}
              </Button>
            ))}
          </div>
        ))}
        {pending && (
          <SelfiePunch
            label={t(PUNCH_LABEL[pending.type])}
            retentionDays={me.data?.photoRetentionDays ?? 90}
            busy={punch.isPending}
            onCapture={(selfie) => punch.mutate({ ...pending, selfie })}
            onCancel={() => setPending(null)}
          />
        )}
      </CardContent>
    </SectionCard>
  );
}
