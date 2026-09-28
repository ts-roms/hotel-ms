'use client';

import { Button, cn } from '@hotel/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return t('notif.now');
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h` : new Date(iso).toLocaleDateString('en-PH');
};

/** In-app notifications (ADR-0024): unread count, a short list, open or mark read. */
export function NotificationBell({ placement = 'up' }: { placement?: 'up' | 'down' }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.me.notifications(),
    refetchInterval: 30_000,
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: api.me.readNotification, onSuccess: refresh });
  const readAll = useMutation({ mutationFn: api.me.readAllNotifications, onSuccess: refresh });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (list.error) return null;
  const unread = list.data?.unread ?? 0;
  return (
    <div className="relative" ref={panel}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${t('notif.title')}${unread ? ` (${unread})` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t('notif.title')}
          className={cn(
            'absolute z-50 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground text-sm shadow-xl',
            placement === 'up' ? 'bottom-11 left-0' : 'right-0 top-11',
          )}
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
              <button
                key={n.id}
                type="button"
                className={cn(
                  'flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left transition-colors last:border-0 hover:bg-accent/50',
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
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(n.createdAt)}</span>
                </span>
                {n.body && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
