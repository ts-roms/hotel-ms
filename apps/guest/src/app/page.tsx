import { buttonVariants, CardContent } from '@hotel/ui';
import { ArrowRight, Mail } from 'lucide-react';
import Link from 'next/link';
import { GuestShell } from '@/components/guest-shell';
import { t } from '@/lib/i18n';

export default function HomePage() {
  return (
    <GuestShell title={t('app.name')} description={t('home.description')}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
          <Mail className="size-5 shrink-0 text-primary" />
          {t('home.emailHint')}
        </div>
        <div className="flex flex-col gap-2 text-center">
          <span className="text-xs text-muted-foreground">{t('home.alreadyOpened')}</span>
          <Link href="/stay" className={buttonVariants({ variant: 'outline' })}>
            {t('home.continue')}
            <ArrowRight />
          </Link>
        </div>
      </CardContent>
    </GuestShell>
  );
}
