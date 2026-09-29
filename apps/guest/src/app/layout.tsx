import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: t('app.name'),
  description: t('app.description'),
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: t('app.name') },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1d4ed8' },
    { media: '(prefers-color-scheme: dark)', color: '#101320' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="guest-backdrop min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
