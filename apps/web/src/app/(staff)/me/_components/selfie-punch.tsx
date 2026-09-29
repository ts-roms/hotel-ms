'use client';

import { Alert, Button } from '@hotel/ui';
import { Camera } from 'lucide-react';
import { SelfiePreview, useSelfieCamera } from '@/components/selfie-camera';
import { t } from '@/lib/i18n';

/** Camera panel for one punch; the stream stops when it closes. */
export function SelfiePunch({
  label,
  retentionDays,
  busy,
  onCapture,
  onCancel,
}: {
  label: string;
  retentionDays: number;
  busy: boolean;
  onCapture: (selfie: Blob) => void;
  onCancel: () => void;
}) {
  const camera = useSelfieCamera();
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <SelfiePreview camera={camera} className="max-w-sm" />
      {camera.error && <Alert>{camera.error}</Alert>}
      <p className="text-xs text-muted-foreground">
        {t('clock.photoNotice')} {retentionDays} {t('clock.days')}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={!camera.ready}
          onClick={() => void camera.capture().then(onCapture)}
        >
          <Camera className="size-4" />
          {t('clock.takePhoto')} · {label}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('fin.cancel')}
        </Button>
      </div>
    </div>
  );
}
