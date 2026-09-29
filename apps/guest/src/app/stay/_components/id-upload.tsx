'use client';

import { GUEST_ID_TYPES, type GuestIdType, type GuestStay } from '@hotel/contracts';
import { Alert, Button, CardContent, Label, Notice, NativeSelect } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, IdCard, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Section } from '@/components/section';
import { api, errorMessage, rememberStay } from '@/lib/api';
import { t } from '@/lib/i18n';

const idLabel = (type: GuestIdType) => t(`id.type.${type}`);

/** A photo or scan of an ID, for the front desk to approve (ADR-0027). */
export function IdUpload({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<GuestIdType>(s.identity?.documentType ?? 'PASSPORT');
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadId(file, type),
    onSuccess: (stay) => {
      queryClient.setQueryData(['stay'], rememberStay(stay));
      if (input.current) input.current.value = '';
    },
  });
  const id = s.identity;

  if (id?.status === 'APPROVED') {
    return (
      <Section
        icon={<IdCard />}
        title={t('id.approvedTitle')}
        description={t('id.approvedDescription', {
          type: idLabel(id.documentType).toLowerCase(),
        })}
      />
    );
  }
  return (
    <Section
      icon={<IdCard />}
      title={t('id.title')}
      description={s.identityRequired ? t('id.required') : t('id.optional')}
    >
      <CardContent className="flex flex-col gap-3">
        {id?.status === 'PENDING' && (
          <Notice>
            <Clock className="mr-1 inline size-4" />
            {t('id.pending')}
          </Notice>
        )}
        {id?.status === 'REJECTED' && (
          <Alert>
            {id.rejectionReason
              ? t('id.rejectedWithReason', { reason: id.rejectionReason })
              : t('id.rejected')}
          </Alert>
        )}
        {upload.error && <Alert>{errorMessage(upload.error)}</Alert>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="id-type">{t('id.typeLabel')}</Label>
          <NativeSelect
            id="id-type"
            value={type}
            onChange={(e) => setType(e.target.value as GuestIdType)}
          >
            {GUEST_ID_TYPES.map((idType) => (
              <option key={idType} value={idType}>
                {idLabel(idType)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          aria-label={t('id.photo')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
          }}
        />
        <Button
          size="lg"
          variant={id ? 'outline' : 'default'}
          loading={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {!upload.isPending && <Upload />}
          {id ? t('id.uploadNew') : t('id.upload')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('id.hint')}</p>
      </CardContent>
    </Section>
  );
}
