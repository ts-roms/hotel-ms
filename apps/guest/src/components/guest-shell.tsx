import { Card, CardDescription, CardHeader, CardTitle } from '@hotel/ui';
import { House } from 'lucide-react';
import type { ReactNode } from 'react';

export function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-info text-primary-foreground shadow-lg shadow-primary/30"
    >
      <House className="size-6" />
    </span>
  );
}

/** Centered card for the screens a guest sees before their stay loads. */
export function GuestShell({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="animate-fade-in">
          <BrandMark />
        </div>
        <Card className="w-full animate-scale-in border-border/70 bg-card/90 shadow-xl shadow-black/5 backdrop-blur-xl">
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
