import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { themeScript } from '@/components/theme-script';
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafc' },
    { media: '(prefers-color-scheme: dark)', color: '#101119' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets html.dark before hydration, so React must not flag the class.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
