'use client';

import { elapsed } from '@hotel/format';
import { Badge, Button, CardContent } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { useState } from 'react';
import { Section } from '@/components/section';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

const timeAgo = (iso: string) => {
  const e = elapsed(iso);
  if (e.unit === 'now') return t('time.justNow');
  if (e.unit === 'minutes') return t('time.minutesAgo', { count: e.value });
  if (e.unit === 'hours') return t('time.hoursAgo', { count: e.value });
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
};

/**
 * Updates from the hotel (ADR-0027): requests, orders, the ID review, checkout, front desk
 * messages.
 */
export function Notifications({ unread }: { unread: number }) {
  const queryClient = useQueryClient();
  const [all, setAll] = useState(false);
  const feed = useQuery({
    queryKey: ['guest-notifications'],
    queryFn: api.notifications,
    refetchInterval: 60_000,
  });
  const read = useMutation({
    mutationFn: api.markNotificationsRead,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['guest-notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['stay'] }),
      ]),
  });
  const items = feed.data ?? [];
  if (items.length === 0) return null;
  return (
    <Section
      icon={<Bell />}
      title={
        <span className="flex items-center gap-2">
          {t('notifications.title')}
          {unread > 0 && (
            <Badge variant="primary">{t('notifications.new', { count: unread })}</Badge>
          )}
        </span>
      }
    >
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {(all ? items : items.slice(0, 5)).map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border p-3 text-sm ${n.read ? '' : 'border-primary/40 bg-primary/5'}`}
            >
              <p className="flex items-start justify-between gap-2">
                <span className="font-medium">{n.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(n.createdAt)}
                </span>
              </p>
              {n.body && <p className="mt-0.5 text-muted-foreground">{n.body}</p>}
            </li>
          ))}
        </ul>
        {!all && items.length > 5 && (
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            {t('notifications.showAll', { count: items.length })}
          </Button>
        )}
        {unread > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            loading={read.isPending}
            onClick={() => read.mutate()}
          >
            <Check />
            {t('notifications.markAllRead')}
          </Button>
        )}
      </CardContent>
    </Section>
  );
}
