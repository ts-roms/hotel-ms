'use client';

import { type GuestStay } from '@hotel/contracts';
import { Button, buttonVariants } from '@hotel/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut, Mail, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

export function ContactFooter({ stay: s }: { stay: GuestStay }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.setQueryData(['stay'], undefined),
  });
  return (
    <footer className="flex flex-col items-center gap-3 pt-4 text-center text-sm text-muted-foreground">
      <span className="font-medium text-foreground">
        {s.property.name}
        {s.property.city && `, ${s.property.city}`}
      </span>
      {(s.property.phone || s.property.email) && (
        <div className="flex flex-wrap justify-center gap-2">
          {s.property.phone && (
            <a
              href={`tel:${s.property.phone}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Phone />
              {s.property.phone}
            </a>
          )}
          {s.property.email && (
            <a
              href={`mailto:${s.property.email}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Mail />
              {s.property.email}
            </a>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>
        {!logout.isPending && <LogOut />}
        {t('contact.signOut')}
      </Button>
      {logout.isSuccess && <span>{t('contact.signedOut')}</span>}
    </footer>
  );
}
