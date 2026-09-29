import type { MetadataRoute } from 'next';
import { t } from '@/lib/i18n';

/** Installable PWA (spec §23): opens straight into the stay page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: t('app.name'),
    short_name: t('app.name'),
    description: t('app.description'),
    start_url: '/stay',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1d4ed8',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
