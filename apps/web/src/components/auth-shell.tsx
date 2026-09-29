import { Card, CardDescription, CardHeader, CardTitle, cn } from '@hotel/ui';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { BrandMark } from './brand';

/**
 * Soft gradient backdrop with the brand above a centered column. The `(auth)` route group's
 * layout renders it once for every sign-in screen; each page renders its own {@link AuthCard}.
 */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <main className="auth-backdrop relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div aria-hidden="true" className="grid-pattern pointer-events-none absolute inset-0" />
      <div className="relative flex w-full flex-col items-center">
        <div className="mb-6 flex animate-fade-in items-center justify-center gap-2.5">
          <BrandMark />
          <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
        </div>
        {children}
      </div>
    </main>
  );
}

/** The centered card of a sign-in screen, with its title and description. */
export function AuthCard({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Widen the card, e.g. `max-w-md` (default `max-w-sm`). */
  className?: string;
}) {
  return (
    <Card
      className={cn(
        'w-full max-w-sm animate-scale-in border-border/70 bg-card/85 shadow-xl shadow-black/5 backdrop-blur-xl',
        className,
      )}
    >
      <CardHeader className="gap-2 pb-4 text-center">
        <CardTitle className="text-xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children}
    </Card>
  );
}

/** Backdrop and card in one, for screens outside the `(auth)` group (the kiosk). */
export function AuthShell(props: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AuthBackdrop>
      <AuthCard {...props} />
    </AuthBackdrop>
  );
}
