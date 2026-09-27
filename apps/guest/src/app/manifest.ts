import type { MetadataRoute } from 'next';

/** Installable PWA (spec §23): opens straight into the stay page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'My stay',
    short_name: 'My stay',
    description: 'Your booking, online check-in and requests during your stay.',
    start_url: '/stay',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1d4ed8',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
