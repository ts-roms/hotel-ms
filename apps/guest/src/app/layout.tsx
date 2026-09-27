import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'My stay',
  description: 'Your booking, online check-in and requests during your stay.',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'My stay' },
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
