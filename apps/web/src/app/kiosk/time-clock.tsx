'use client';

import type { createKioskApiClient } from '@hotel/api-client';
import type { ClockPunchResult, KioskState, PunchType } from '@hotel/contracts';
import { Alert, Button, Card, CardContent, Input } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { Camera, CheckCircle2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';

type Kiosk = ReturnType<typeof createKioskApiClient>;

const ACTIONS: { type: PunchType; label: Parameters<typeof t>[0]; primary?: boolean }[] = [
  { type: 'IN', label: 'clock.in', primary: true },
  { type: 'BREAK_START', label: 'clock.breakStart' },
  { type: 'BREAK_END', label: 'clock.breakEnd' },
  { type: 'OUT', label: 'clock.out', primary: true },
];

/** One frame from the camera, as a JPEG (a selfie is taken at the moment of the punch). */
function snapshot(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / (video.videoWidth || 640));
  canvas.width = Math.round((video.videoWidth || 640) * scale);
  canvas.height = Math.round((video.videoHeight || 480) * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No image'))), 'image/jpeg', 0.8),
  );
}

/**
 * Time clock screen (ADR-0022): Employee ID, then In / Break / Out. The camera takes a
 * selfie with every punch; the photo goes to HR, never shown back on this shared screen.
 */
export function TimeClock({ state, kiosk }: { state: KioskState; kiosk: Kiosk }) {
  const video = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [employeeNo, setEmployeeNo] = useState('');
  const [done, setDone] = useState<ClockPunchResult | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
        setReady(true);
      })
      .catch(() => setCameraError(t('clock.noCamera')));
    if (!navigator.mediaDevices) setCameraError(t('clock.noCamera'));
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const punch = useMutation({
    mutationFn: async (type: PunchType) =>
      kiosk.clock(employeeNo.trim(), type, await snapshot(video.current!)),
    onSuccess: (result) => {
      setDone(result);
      setEmployeeNo('');
      setTimeout(() => setDone(null), 5_000);
    },
  });

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="text-center">
            <div className="text-4xl font-semibold tabular-nums">
              {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-sm text-muted-foreground">
              {state.device.name} · {state.device.propertyName}
            </div>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
            <video
              ref={video}
              autoPlay
              playsInline
              muted
              className="size-full -scale-x-100 object-cover"
              aria-label={t('clock.camera')}
            />
            {!ready && !cameraError && (
              <Camera className="absolute inset-0 m-auto size-10 text-muted-foreground" />
            )}
          </div>
          {cameraError && <Alert>{cameraError}</Alert>}
          {done ? (
            <div
              role="status"
              className="flex flex-col items-center gap-1 rounded-xl bg-success/10 p-4 text-center"
            >
              <CheckCircle2 className="size-8 text-success" />
              <strong>
                {done.type === 'IN' ? t('clock.hello') : t('clock.thanks')}, {done.employeeName}
              </strong>
              <span className="text-sm text-muted-foreground">
                {t(ACTIONS.find((a) => a.type === done.type)!.label)} ·{' '}
                {new Date(done.at).toLocaleTimeString('en-PH', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ) : (
            <>
              <Input
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                aria-label={t('clock.employeeId')}
                placeholder={t('clock.employeeId')}
                className="text-center font-mono text-lg tracking-widest"
                value={employeeNo}
                onChange={(e) => setEmployeeNo(e.target.value)}
              />
              {punch.error && <Alert>{errorMessage(punch.error)}</Alert>}
              <div className="grid grid-cols-2 gap-2">
                {ACTIONS.map((a) => (
                  <Button
                    key={a.type}
                    size="lg"
                    variant={a.primary ? 'default' : 'outline'}
                    disabled={!ready || !employeeNo.trim() || punch.isPending}
                    loading={punch.isPending && punch.variables === a.type}
                    onClick={() => punch.mutate(a.type)}
                  >
                    {t(a.label)}
                  </Button>
                ))}
              </div>
              <p className="text-center text-xs text-muted-foreground">{t('clock.photoNotice')}</p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
