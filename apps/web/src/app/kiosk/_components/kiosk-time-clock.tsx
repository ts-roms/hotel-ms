'use client';

import type { createKioskApiClient } from '@hotel/api-client';
import type { ClockPunchResult, KioskState, PunchType } from '@hotel/contracts';
import { formatTime } from '@hotel/format';
import { Alert, Button, Card, CardContent, Input } from '@hotel/ui';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SelfiePreview, useSelfieCamera } from '@/components/selfie-camera';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { PUNCH_LABEL } from '@/lib/hr';

type Kiosk = ReturnType<typeof createKioskApiClient>;

/** Kiosk buttons in screen order; labels are shared with My time (`PUNCH_LABEL`). */
const ACTIONS: { type: PunchType; primary?: boolean }[] = [
  { type: 'IN', primary: true },
  { type: 'BREAK_START' },
  { type: 'BREAK_END' },
  { type: 'OUT', primary: true },
];

/**
 * Time clock screen (ADR-0022): Employee ID, then In / Break / Out. The camera takes a
 * selfie with every punch; the photo goes to HR, never shown back on this shared screen.
 */
export function KioskTimeClock({ state, kiosk }: { state: KioskState; kiosk: Kiosk }) {
  const camera = useSelfieCamera();
  const [employeeNo, setEmployeeNo] = useState('');
  const [done, setDone] = useState<ClockPunchResult | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const punch = useMutation({
    mutationFn: async (type: PunchType) =>
      kiosk.clock(employeeNo.trim(), type, await camera.capture()),
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
            <div className="text-4xl font-semibold tabular-nums">{formatTime(now)}</div>
            <div className="text-sm text-muted-foreground">
              {state.device.name} · {state.device.propertyName}
            </div>
          </div>
          <SelfiePreview camera={camera} />
          {camera.error && <Alert>{camera.error}</Alert>}
          {done ? (
            <div
              role="status"
              className="flex flex-col items-center gap-1 rounded-xl bg-success/10 p-4 text-center"
            >
              <CheckCircle2 className="size-8 text-success" />
              <strong>
                {t(done.type === 'IN' ? 'clock.hello' : 'clock.thanks', {
                  name: done.employeeName,
                })}
              </strong>
              <span className="text-sm text-muted-foreground">
                {t(PUNCH_LABEL[done.type])} · {formatTime(done.at)}
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
                    disabled={!camera.ready || !employeeNo.trim() || punch.isPending}
                    loading={punch.isPending && punch.variables === a.type}
                    onClick={() => punch.mutate(a.type)}
                  >
                    {t(PUNCH_LABEL[a.type])}
                  </Button>
                ))}
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {t('clock.photoNotice', { days: state.photoRetentionDays })}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
