'use client';

import { DEVICE_PERMISSIONS, type DevicePairing } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Notice,
  PageHeader,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { statusVariant } from '@/lib/status';

const PERMISSION_LABELS: Record<(typeof DEVICE_PERMISSIONS)[number], string> = {
  'fnb.order.read': 'See orders',
  'fnb.order.update': 'Move orders along',
  'fnb.menu.availability': 'Mark items sold out',
};

/** Shared devices of a property (ADR-0020). */
export default function DevicesPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ['devices', propertyId], queryFn: pms.devices });
  const [name, setName] = useState('Kitchen tablet');
  const [permissions, setPermissions] = useState<string[]>([...DEVICE_PERMISSIONS]);
  const [pairing, setPairing] = useState<DevicePairing | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['devices', propertyId] });
  const act = useMutation({
    mutationFn: (fn: () => Promise<DevicePairing | unknown>) => fn(),
    onSuccess: (result) => {
      if (result && typeof result === 'object' && 'pairingCode' in result)
        setPairing(result as DevicePairing);
      return refresh();
    },
  });
  const create = (e: FormEvent) => {
    e.preventDefault();
    act.mutate(() =>
      pms.createDevice({
        name: name.trim(),
        permissions: permissions as (typeof DEVICE_PERMISSIONS)[number][],
      }),
    );
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('dev.title')} description={t('dev.hint')} />
      {act.error && <Alert>{errorMessage(act.error)}</Alert>}
      {pairing && (
        <Notice>
          <strong>{pairing.device.name}</strong> · {t('dev.pairingOpen')}{' '}
          {new Date(pairing.expiresAt).toLocaleTimeString('en-PH')}
          <div className="mt-2 font-mono text-2xl tracking-widest">
            {pairing.pairingCode.slice(0, 4)}-{pairing.pairingCode.slice(4)}
          </div>
        </Notice>
      )}

      <Card>
        <CardContent className="flex flex-col gap-2 pt-5 text-sm">
          {devices.error && <Alert>{errorMessage(devices.error)}</Alert>}
          {devices.data?.length === 0 && <p className="text-muted-foreground">{t('dev.none')}</p>}
          {devices.data?.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  {d.name}
                  <Badge variant={statusVariant(d.status === 'PAIRED' ? 'ACTIVE' : d.status)}>
                    {d.status.toLowerCase()}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {d.permissions.map((p) => PERMISSION_LABELS[p]).join(' · ')}
                  {d.lastSeenAt &&
                    ` · ${t('dev.lastSeen')} ${new Date(d.lastSeenAt).toLocaleString('en-PH')}`}
                </span>
              </span>
              {d.status !== 'REVOKED' && (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={act.isPending}
                    onClick={() => act.mutate(() => pms.repairDevice(d.id))}
                  >
                    {t('dev.newCode')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:text-destructive"
                    disabled={act.isPending}
                    onClick={() => {
                      if (window.confirm(t('dev.revokeConfirm')))
                        act.mutate(() => pms.revokeDevice(d.id));
                    }}
                  >
                    {t('dev.revoke')}
                  </Button>
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('dev.add')}</CardTitle>
          <CardDescription>{t('kiosk.pairHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex flex-col gap-3 text-sm">
            <Input
              required
              maxLength={60}
              aria-label={t('dev.name')}
              placeholder={t('dev.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <fieldset className="flex flex-wrap gap-4">
              {DEVICE_PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={permissions.includes(p)}
                    onChange={(e) =>
                      setPermissions(
                        e.target.checked ? [...permissions, p] : permissions.filter((x) => x !== p),
                      )
                    }
                  />
                  {PERMISSION_LABELS[p]}
                </label>
              ))}
            </fieldset>
            <Button
              type="submit"
              variant="outline"
              className="self-start"
              loading={act.isPending}
              disabled={!name.trim() || permissions.length === 0}
            >
              {t('dev.add')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
