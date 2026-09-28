'use client';

import type { LostFoundItem } from '@hotel/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageSearch } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePms, useRoutePropertyId } from '@/lib/property';
import { hasPermission, useSession } from '@/lib/session';
import { statusLabel } from '@/lib/status';

const CATEGORIES = ['VALUABLES', 'DOCUMENTS', 'ELECTRONICS', 'CLOTHING', 'OTHER'] as const;

/** Lost & found (spec §31, ADR-0023). */
export default function LostFoundPage() {
  const propertyId = useRoutePropertyId()!;
  const pms = usePms(propertyId);
  const session = useSession();
  const [status, setStatus] = useState<'HELD' | 'CLOSED' | 'ALL'>('HELD');
  const [q, setQ] = useState('');
  const items = useQuery({
    queryKey: ['lost-found', propertyId, status, q],
    queryFn: () => pms.lostFound({ status, ...(q.trim() ? { q: q.trim() } : {}) }),
  });
  const canClose = hasPermission(session.data, 'lost_found.manage');

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title={t('lf.title')} description={t('lf.hint')} />
      <LogItem propertyId={propertyId} />
      <div className="flex flex-wrap gap-2">
        {(['HELD', 'CLOSED', 'ALL'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {t(`lf.${s.toLowerCase()}` as Parameters<typeof t>[0])}
          </Button>
        ))}
        <Input
          className="h-9 w-56"
          aria-label={t('lf.search')}
          placeholder={t('lf.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {items.error && <Alert>{errorMessage(items.error)}</Alert>}
      {items.data?.length === 0 && <EmptyState icon={<PackageSearch />} title={t('lf.none')} />}
      <div className="flex flex-col gap-2">
        {items.data?.map((item) => (
          <Item key={item.id} propertyId={propertyId} item={item} canClose={canClose} />
        ))}
      </div>
    </div>
  );
}

function LogItem({ propertyId }: { propertyId: string }) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const rooms = useQuery({ queryKey: ['rooms', propertyId], queryFn: pms.rooms });
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('OTHER');
  const [foundLocation, setFoundLocation] = useState('');
  const [roomId, setRoomId] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const log = useMutation({
    mutationFn: () =>
      pms.logLostItem({
        description: description.trim(),
        category: category as LostFoundItem['category'],
        foundLocation: foundLocation.trim(),
        roomId: roomId || null,
        storageLocation: storageLocation.trim(),
      }),
    onSuccess: () => {
      setDescription('');
      setFoundLocation('');
      setRoomId('');
      return queryClient.invalidateQueries({ queryKey: ['lost-found', propertyId] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('lf.log')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-2 text-sm sm:grid-cols-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            log.mutate();
          }}
        >
          {log.error && <Alert className="sm:col-span-3">{errorMessage(log.error)}</Alert>}
          <Input
            required
            className="sm:col-span-2"
            aria-label={t('lf.description')}
            placeholder={t('lf.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            aria-label={t('lf.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {statusLabel(c)}
              </option>
            ))}
          </Select>
          <Input
            required
            aria-label={t('lf.foundWhere')}
            placeholder={t('lf.foundWhere')}
            value={foundLocation}
            onChange={(e) => setFoundLocation(e.target.value)}
          />
          <Select
            aria-label={t('mnt.room')}
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">{t('mnt.notARoom')}</option>
            {rooms.data
              ?.filter((r) => !r.archived)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {t('mnt.room')} {r.number}
                </option>
              ))}
          </Select>
          <Input
            required
            aria-label={t('lf.storedAt')}
            placeholder={t('lf.storedAt')}
            value={storageLocation}
            onChange={(e) => setStorageLocation(e.target.value)}
          />
          <Button type="submit" className="self-start" loading={log.isPending}>
            {t('lf.log')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Item({
  propertyId,
  item,
  canClose,
}: {
  propertyId: string;
  item: LostFoundItem;
  canClose: boolean;
}) {
  const pms = usePms(propertyId);
  const queryClient = useQueryClient();
  const [closing, setClosing] = useState<'RETURNED' | 'DISPOSED' | null>(null);
  const [note, setNote] = useState('');
  const close = useMutation({
    mutationFn: () =>
      pms.closeLostItem(item.id, item.version, { status: closing!, note: note.trim() }),
    onSuccess: () => {
      setClosing(null);
      return queryClient.invalidateQueries({ queryKey: ['lost-found', propertyId] });
    },
  });
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{item.itemNo}</span>
            <span className="font-medium">{item.description}</span>
            <Badge variant={item.status === 'HELD' ? 'warning' : 'neutral'}>
              {statusLabel(item.status)}
            </Badge>
          </span>
          <span className="text-xs text-muted-foreground">
            {item.daysHeld} {t('lf.days')}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {statusLabel(item.category)} · {t('lf.found')} {item.foundLocation}
          {item.roomNumber && ` (${t('mnt.room')} ${item.roomNumber})`} ·{' '}
          {new Date(item.foundAt).toLocaleString('en-PH')}
          {item.foundByName && ` · ${item.foundByName}`} · {t('lf.storedAt')}:{' '}
          {item.storageLocation}
        </span>
        {item.closingNote && <span>{item.closingNote}</span>}
        {close.error && <Alert>{errorMessage(close.error)}</Alert>}
        {item.status === 'HELD' && canClose && !closing && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setClosing('RETURNED')}>
              {t('lf.return')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setClosing('DISPOSED')}>
              {t('lf.dispose')}
            </Button>
          </div>
        )}
        {closing && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              close.mutate();
            }}
          >
            <Input
              className="min-w-64 flex-1"
              aria-label={t('lf.closingNote')}
              placeholder={closing === 'RETURNED' ? t('lf.returnHint') : t('lf.disposeHint')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              type="submit"
              loading={close.isPending}
              disabled={note.trim().length < 3}
            >
              {closing === 'RETURNED' ? t('lf.return') : t('lf.dispose')}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setClosing(null)}>
              {t('fin.cancel')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
