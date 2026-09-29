import { BrandMark, cn, ShellCard } from '@hotel/ui';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Hotel } from 'lucide-react';

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
          <BrandMark icon={Hotel} />
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
    <ShellCard
      title={title}
      description={description}
      className={cn('max-w-sm bg-card/85', className)}
    >
      {children}
    </ShellCard>
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
