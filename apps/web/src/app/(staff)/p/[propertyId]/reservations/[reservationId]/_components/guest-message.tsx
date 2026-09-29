'use client';

import { Alert, Button, Input, Textarea } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms } from '@/lib/property';

/** A note to the guest's portal feed (ADR-0027), e.g. "Your room is ready". */
export function GuestMessage({
  propertyId,
  reservationId,
  lineId,
}: {
  propertyId: string;
  reservationId: string;
  lineId: string;
}) {
  const pms = usePms(propertyId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => pms.messageGuest(reservationId, lineId, { title, body }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setOpen(false);
    },
  });
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <MessageSquare />
          {t('res.messageGuest')}
        </Button>
        {send.isSuccess && <span className="text-muted-foreground">{t('res.messageSent')}</span>}
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2 border-t pt-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <Input
        required
        maxLength={120}
        aria-label={t('res.messageTitle')}
        placeholder={t('res.messageTitle')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Textarea
        maxLength={1000}
        rows={2}
        aria-label={t('res.messageBody')}
        placeholder={t('res.messageBody')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {send.error && <Alert>{errorMessage(send.error)}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={send.isPending} disabled={!title.trim()}>
          {t('res.sendMessage')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('fin.cancel')}
        </Button>
      </div>
    </form>
  );
}
