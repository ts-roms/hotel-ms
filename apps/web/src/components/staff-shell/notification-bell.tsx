'use client';

import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { timeSince } from '@/lib/time';

/** In-app notifications (ADR-0024): unread count, a short list, open or mark read. */
export function NotificationBell({ placement = 'up' }: { placement?: 'up' | 'down' }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.me.notifications(),
    refetchInterval: 30_000,
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: api.me.readNotification, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: api.me.readAllNotifications, onSuccess: refresh });

  if (list.error) return null;
  const unread = list.data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? t('notif.titleUnread', { count: unread }) : t('notif.title')}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={t('notif.title')}
        side={placement === 'up' ? 'top' : 'bottom'}
        align={placement === 'up' ? 'start' : 'end'}
        collisionPadding={8}
        className="flex max-h-[70vh] w-80 flex-col overflow-hidden p-0 text-sm shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <strong>{t('notif.title')}</strong>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={() => readAll.mutate()}>
              {t('notif.readAll')}
            </Button>
          )}
        </div>
        <div className="overflow-y-auto">
          {list.data?.items.length === 0 && (
            <p className="px-3 py-6 text-center text-muted-foreground">{t('notif.none')}</p>
          )}
          {list.data?.items.map((n) => (
            <Button
              key={n.id}
              variant="ghost"
              className={cn(
                'h-auto w-full flex-col items-stretch gap-0.5 whitespace-normal rounded-none border-b px-3 py-2 text-left font-normal text-card-foreground last:border-0 hover:bg-accent/50 hover:text-card-foreground active:scale-100',
                !n.read && 'bg-primary/5',
              )}
              onClick={() => {
                if (!n.read) read.mutate(n.id);
                setOpen(false);
                if (n.link) router.push(n.link);
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={cn('font-medium', !n.read && 'text-primary')}>{n.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeSince(n.createdAt)}
                </span>
              </span>
              {n.body && (
                <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
              )}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
