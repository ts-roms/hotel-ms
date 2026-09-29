'use client';

import type { GuestPortalSettings } from '@hotel/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Notice,
  PageHeader,
  Textarea,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';

/** What guests see in the portal, and the self check-in ID rule (ADR-0027). */
export default function GuestPortalSettingsPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const settings = useQuery({
    queryKey: ['guest-portal-settings', propertyId],
    queryFn: pms.guestPortalSettings,
  });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('gps.title')} description={t('gps.hint')} />
      {settings.error && <Alert>{errorMessage(settings.error)}</Alert>}
      {settings.data && <SettingsForm propertyId={propertyId} initial={settings.data} />}
    </div>
  );
}

function SettingsForm({
  propertyId,
  initial,
}: {
  propertyId: string;
  initial: GuestPortalSettings;
}) {
  const pms = usePms(propertyId);
  const session = useSession();
  const canManage = hasPermission(session.data, 'property.settings.manage');
  const queryClient = useQueryClient();
  const [s, setS] = useState(initial);
  const [amenities, setAmenities] = useState(initial.amenities.join('\n'));
  const set = <K extends keyof GuestPortalSettings>(key: K, value: GuestPortalSettings[K]) =>
    setS((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () =>
      pms.updateGuestPortalSettings({
        ...s,
        amenities: amenities
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        services: s.services.filter((x) => x.name.trim()),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['guest-portal-settings', propertyId], data);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const service = (i: number, patch: Partial<GuestPortalSettings['services'][number]>) =>
    set(
      'services',
      s.services.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    );

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {!canManage && <Notice>{t('gps.readOnly')}</Notice>}
      <fieldset disabled={!canManage} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('gps.selfCheckIn')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Label className="flex items-start gap-2 font-normal leading-normal">
              <Checkbox
                className="mt-0.5"
                checked={s.requireIdForSelfCheckIn}
                onCheckedChange={(v) => set('requireIdForSelfCheckIn', v === true)}
              />
              <span>
                {t('gps.requireId')}
                <span className="block text-muted-foreground">{t('gps.requireIdHint')}</span>
              </span>
            </Label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('gps.info')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Label className="flex flex-col gap-1">
              {t('gps.about')}
              <Textarea
                maxLength={2000}
                rows={4}
                value={s.about}
                onChange={(e) => set('about', e.target.value)}
              />
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label className="flex flex-col gap-1">
                {t('gps.wifiName')}
                <Input
                  maxLength={80}
                  value={s.wifiName}
                  onChange={(e) => set('wifiName', e.target.value)}
                />
              </Label>
              <Label className="flex flex-col gap-1">
                {t('gps.wifiPassword')}
                <Input
                  maxLength={80}
                  value={s.wifiPassword}
                  onChange={(e) => set('wifiPassword', e.target.value)}
                />
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('gps.wifiHint')}</p>
            <Label className="flex flex-col gap-1">
              {t('gps.amenities')}
              <Textarea
                rows={4}
                placeholder={t('gps.amenitiesHint')}
                value={amenities}
                onChange={(e) => setAmenities(e.target.value)}
              />
            </Label>
            <Label className="flex flex-col gap-1">
              {t('gps.houseRules')}
              <Textarea
                maxLength={2000}
                rows={3}
                value={s.houseRules}
                onChange={(e) => set('houseRules', e.target.value)}
              />
            </Label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('gps.services')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {s.services.length === 0 && (
              <p className="text-muted-foreground">{t('gps.noServices')}</p>
            )}
            {s.services.map((x, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label={t('gps.serviceName')}
                  placeholder={t('gps.serviceName')}
                  maxLength={80}
                  value={x.name}
                  onChange={(e) => service(i, { name: e.target.value })}
                />
                <Input
                  aria-label={t('gps.serviceHours')}
                  placeholder={t('gps.serviceHours')}
                  maxLength={80}
                  value={x.hours}
                  onChange={(e) => service(i, { hours: e.target.value })}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('gps.removeService')}
                  onClick={() =>
                    set(
                      'services',
                      s.services.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 />
                </Button>
                <Input
                  className="sm:col-span-3"
                  aria-label={t('gps.serviceDescription')}
                  placeholder={t('gps.serviceDescription')}
                  maxLength={300}
                  value={x.description}
                  onChange={(e) => service(i, { description: e.target.value })}
                />
              </div>
            ))}
            {s.services.length < 30 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  set('services', [...s.services, { name: '', description: '', hours: '' }])
                }
              >
                <Plus />
                {t('gps.addService')}
              </Button>
            )}
          </CardContent>
        </Card>
      </fieldset>
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      {save.isSuccess && <Notice>{t('gps.saved')}</Notice>}
      {canManage && (
        <Button type="submit" className="self-start" loading={save.isPending}>
          {t('gps.save')}
        </Button>
      )}
    </form>
  );
}
