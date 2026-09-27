import { Card, CardDescription, CardHeader, CardTitle, cn } from '@hotel/ui';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { BrandMark } from './brand';

/** Centered card on a soft gradient backdrop, shared by every signed-out screen. */
export function AuthShell({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className="auth-backdrop relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div aria-hidden="true" className="grid-pattern pointer-events-none absolute inset-0" />
      <div className={cn('relative w-full max-w-sm', className)}>
        <div className="mb-6 flex animate-fade-in items-center justify-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
        </div>
        <Card className="animate-scale-in border-border/70 bg-card/85 shadow-xl shadow-black/5 backdrop-blur-xl">
          <CardHeader className="gap-2 pb-4 text-center">
            <CardTitle className="text-xl">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          {children}
        </Card>
      </div>
    </main>
  );
}
