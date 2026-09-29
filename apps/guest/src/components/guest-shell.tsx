import { BrandMark, ShellCard } from '@hotel/ui';
import { House } from 'lucide-react';
import type { ReactNode } from 'react';

/** The guest portal's logo tile. */
export function GuestBrandMark() {
  return <BrandMark icon={House} size="lg" />;
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
          <GuestBrandMark />
        </div>
        <ShellCard title={title} description={description}>
          {children}
        </ShellCard>
      </div>
    </main>
  );
}
