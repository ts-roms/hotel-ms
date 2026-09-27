import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: t('app.name'),
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
